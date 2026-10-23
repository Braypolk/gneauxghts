---
status: accepted
---

# Prove agent renames across both locations

Agent filename editing uses a separate same-folder Rename operation under the
same existing-note write permission as content and property changes. The normal
review setting applies; when enabled, review covers the exact old and new
filenames. Note Timeline owns the canonical movement,
durable preparation and recovery; the existing Pi Publication Task owns review
and progression. Update permission covers both editing and renaming; Create
remains an independent permission. Note-scoped grants admit either existing-note
operation, and allowed folders include their subfolders for every enabled
operation. A rename
preserves the Note Identity and exact canonical bytes and records a Lifecycle
Event rather than creating a content revision.

The previous single-location publication proof cannot distinguish an unperformed
move from a committed move whose acknowledgement was lost. Rename therefore
retains both paths and the exact source-byte proof before an atomic no-replace
move. Reconciliation observes that original effect and repairs required
projections; it never repeats the move, restores old content or guesses another
destination. An uncertain source/destination state retains its proof. Editor
admission covers both locations, and committed adoption preserves the existing
Document Handle and shared runtime.

The journal retains whether the canonical owner durably witnessed the exact
destination bytes and identity with the source absent. Before that witness,
mixed or changed states remain uncertain. After it, recovery may finish the
original rename Lifecycle Event from its retained authored payload even if an
external writer has since edited the destination. This records an already
witnessed effect; it never restores those bytes or treats caller fallback
content as current Markdown. A later external edit retains its own observation.
Editor-adoption failure keeps the committed fact and lease, with a retry that
reconciles and adopts through the same owner without another filesystem effect.
A proof failure before a receipt is available also retains the original intent
and a visible Retry. That retry joins the original operation and pending native
admission release before reconciliation; confirmed non-publication releases the
editor pause, a committed receipt refreshes editors, and unavailable proof keeps
the recovery action visible. It never repeats the rename or downgrades a known
committed receipt.

Ordinary saves retain their captured Note Identity and recheck its current
location under canonical file ownership after preflight. A delayed editor or
task save cannot recreate the former filename or overwrite a replacement there.
When reading with a retained identity, a path or catalog entry is only a hint:
the read owner validates canonical identity again after reading. Missing managed
metadata can preserve existing catalog continuity only at a location admitted by
Note Timeline. Path-only reads retain their ordinary filename semantics.

Ordinary title saving and existence-check-then-rename are insufficient for this
tool: a destination appearing after review must remain intact. Supported native
no-replace movement is required; unsupported platforms/filesystems fail closed.
External writers cannot participate in the app's file owner, so source changes
at the movement boundary are checked again and remain uncertain when the exact
approved effect cannot be established. There is no destructive rollback or
copy/delete fallback.

The implementation uses Darwin `renameatx_np` with `RENAME_EXCL` and
`RENAME_NOFOLLOW_ANY` ([XNU manual](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/man/man2/rename.2),
[flags](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/stdio.h)),
or Linux `renameat2` with `RENAME_NOREPLACE`
([manual](https://man7.org/linux/man-pages/man2/rename.2.html)). The containing
directory is synced after movement ([fsync semantics](https://man7.org/linux/man-pages/man2/fsync.2.html)).
Windows remains unsupported for this tool.

The durable proof changes the Note Timeline schema to version 15. Under the
existing no-migration policy, older development histories require an explicit
confirmed reset; canonical Markdown is untouched, while retained history is not
silently upgraded or discarded. A fresh disposable vault is the acceptance lane.

ID-based references keep their Note Identity. Ordinary filename/path links may
stop resolving; the rename tool instructions and enabled review communicate that
consequence. Renaming does
not rewrite backlinks or grant authority to edit other notes. Chat-to-note and
general filesystem administration remain outside this operation.

The permission policy was simplified on 2026-10-22 at the user's request after
reviewing the interface. The initial independent Rename grant, exact-containing-folder
requirement and forced rename review added configuration burden without requiring a
different publication protocol. The tools and native effects remain distinct; permission,
scope and review are shared. Saved grants using the retired `rename` spelling decode
as `update`, with duplicate operations removed. This does not change Note Timeline
storage, the two-location proof, or already prepared intents' review requirements.
