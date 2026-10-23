# Recoverable quick capture, 2026-10-22

## Behavior and ownership

`DraftRecoveryController` captures dirty documents into the native vault-private
draft-backup store. Recovery is advisory: canonical note save, history preparation,
conflict handling and publication retain their existing owners. Backup failure
shows Retry without changing a canonical save result or blocking its completion.

Captures include the title, immutable body, tags/tag parse error, and the source
note ID/path. Titles commit to the document on blur, so the focused title field is
also captured before blur. A clean body with an uncommitted title remains eligible
for recovery. A save completion only retires recovery after the current document
and title field are clean; newer edits remain recoverable.

No Markdown is serialized on each keystroke. Captures coalesce for 400 ms, with a
2-second maximum wait during continuous typing. One backup write runs at a time,
with only the latest pending capture per document. UUID and monotonically increasing
version metadata survive route remounts in a WeakMap. Versioned native tombstones
prevent delayed saves from resurrecting retired work. Clean entries retain no
document reference; the temporary retry reference for a resumed copy is released
after the original recovery row is successfully discarded.

Dormant copies load after vault bootstrap. Resume opens a separate identity-free
draft through the normal commands/document-editing owner. The source note remains
unchanged. The original recovery copy is retained until the new copy is safely
backed up or canonically saved. Retrying after a backup failure reuses the same
resumed draft. Navigation and background settlement flush recovery alongside
canonical persistence; recovery errors do not mask canonical failures.

The compact disclosure stays in normal layout with a bounded scrolling list.
An offset below compact app-shell chrome keeps both its controls and writing
targets reachable. Errors remain visible even when there are no dormant copies.

## Verification

- 61 focused tests passed across recovery, canonical persistence hooks, workspace
  settlement, lifecycle and browser fixture suites. They cover coalescing and
  maximum wait, immutable serialization, one active write/latest pending capture,
  delayed saves/tombstones, remount UUID/version reuse, clean-only retirement,
  focused uncommitted titles, retry after failure, separate-copy safety, original
  retention, stale list completions and advisory failure handling.
- `pnpm check` completed with zero errors and zero warnings after composition.
- Followed the WDIO interactive loop using disposable session `draft-recovery`
  and port 1435. Inspected desktop and 390-pixel screenshots. A compact header
  overlap found in that session was fixed before replay. Interactive trace:
  `e2e/agent/.wdio/session/draft-recovery/trace/2026-10-22T19-05-46-184Z/transcript.md`.
- Cleaned maintained regression `e2e/agent/specs/draft-recovery.e2e.js` fresh-replayed
  with all four scenarios passing: backup error/Retry followed by reload and
  separate-copy resume with source unchanged; focused title before blur; reachable
  disclosure at 390 pixels. No model inference was run.
- Closed the owned interactive browser/server. The fresh replay stopped its own
  server. Fixture backup handlers persist only their explicit
  fixture storage; no real user vault was used.

## Limits

The debounce leaves a brief interval before bytes reach storage; abrupt process
termination during that interval cannot be guaranteed recoverable. Background
and navigation barriers flush work when the application can settle it. Browser
fixture reload tests demonstrate frontend recovery composition, not native process
termination or SQLite durability; native storage tests cover that separate seam.
The fixture's existing missing `pi_chat_bind_editor_owner` and `mark_note_opened`
commands remain visible in test logs rather than being silently accepted.
