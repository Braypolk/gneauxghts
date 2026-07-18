# Editor and Semantic Foundation

See also:

- `docs/architecture.md` for the full system map.
- `docs/features.md` for the feature-by-feature guide.
- `docs/future-work-assessment.md` for current hindrances and recommended next
  steps.

Gneauxghts treats the editor, document session, semantic retrieval, and note
proposal systems as shared foundation layers. Future AI inbox and chat features
should compose these layers instead of reaching into `Notepad.svelte`,
CodeMirror internals, or semantic database/index internals.

## Extension Path

- Use the notepad feature host contract for active document snapshots, editor
  focus, selection snapshots, save/refresh, and document replacement.
- Use semantic retrieval commands/services for search, related-note context,
  and future chat context. `retrieve_note_context` is the neutral context-pack
  API. Consumers should not depend on ANN, SQLite, or embedding implementation
  details.
- Use the backend proposal core for note mutations. Frontend review UX (chat
  file list + CodeMirror inline diff in `src/lib/features/proposals/`) calls
  `apply_note_change_proposal`; Rust remains authoritative for content-hash
  validation and file writes.
- Keep inbox and chat as different UX surfaces over the same retrieval and
  proposal primitives.

## Failure Model

Semantic indexing is a core feature but not a hard startup dependency. Search
and editor workflows must degrade gracefully to lexical/editor-only behavior
when semantic indexing is disabled, unavailable, or still warming up.
