# Support normal context, discovery, permissions and citations

Status: ready-for-agent
Type: task
Milestone: first-usable-desktop
Blocked by: 02, 03, 04

Follow [the spec](../spec.md) and ADR 0009. Composer-supplied active-note context
currently rejects send; discovery/permission UX and historical navigation are absent.

## Work

- Admit open-note hints and selected notes/passages through existing policy.
  Preserve canonical/working-copy distinctions, repeatable explicit references
  and excerpt-only versus full-note scope.
- Expose discovery, reads, temporal/activity and permissions through the bundled
  Pi extension: suggestions, grants/denials, exclusions, versioned cursors and
  explicit unavailable search coverage.
- Persist issued sources/admitted answer bindings with the Pi conversation and
  project normal citation, evidence and read-activity UI.
- Support current passage and retained Note Revision navigation. Revalidate access,
  Note Identity, bytes and change proof at mandatory model/delivery/navigation
  boundaries; ordinary failing hooks are not authorization.

## Acceptance

- Normal send with a note open works; explicit references preserve intended scope.
  Unsaved/pending proposal bytes cannot become canonical evidence.
- Search → permission request → grant/deny → read → citation works in real UI and
  after restart without granting another conversation access.
- Edit/rename/exclude/revoke during inference or after delivery produces correct
  identity resolution or explicit unavailable/conflict behavior. Final inference
  without executable tools still checks current policy.
- Current links focus exact passages; historical links open History Mode. Cleared/
  missing/ambiguous proofs fail explicitly. Unissued references never become guessed
  links or admit provisional structured output.
- Reuse native evidence services; no new retrieval/index system is introduced.

## Starting points

`src/lib/features/chat/ui/ChatComposer.svelte`, Pi ChatApi/notes/provider extension,
`src-tauri/src/pi_prototype_notes.rs`, evidence/context/citation policy and
NoteTimeline's scoped history interfaces.

## Comments
