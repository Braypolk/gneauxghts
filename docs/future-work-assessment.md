# Future Work Assessment

This assessment is based on the current post-cleanup architecture after the
editor/semantic hardening pass.

## Stronger Foundations Now In Place

- The app has a clearer extension target for future editor-aware features:
  `NotepadFeatureHost`.
- Notepad command dependencies are grouped through facades, and pane
  activation/focus has started moving into focused command groups.
- Search and related notes now share current-draft body resolution through
  `current_document`.
- The neutral proposal core gives future AI/chat/inbox work a backend-owned
  path for hash-checked note mutations.
- The app-level event store is a useful cross-feature integration point and
  should reduce duplicated Tauri listeners over time.

## Main Hindrances For Future Work

### 1. Backend Test Baseline Is Clean

`cargo test -- --test-threads=1` now passes. The prior failures were useful:
they exposed title-heading normalization drift, stale wikilink fixture
expectations, and a scaffold cache-directory mismatch.

Recommended next step: keep the backend suite green before broad backend
architecture changes.

### 2. Old AI Docs Have Been Removed

The obsolete `docs/AI_DIFF_REVIEW_*` files described the removed AI
inbox/diff-review implementation and were deleted to avoid presenting
historical implementation notes as current architecture.

Recommended next step: keep future AI inbox/chat design in current architecture
docs until those features are reintroduced.

### 3. Feature Host Has A Runtime Adapter

`NotepadFeatureHost` now has a concrete adapter in `Notepad.svelte`, and
related-note context uses it to read the active document.

Recommended next step: require new editor-aware features to accept
`NotepadFeatureHost` or narrower capability interfaces.

### 4. Semantic Retrieval Has A Context API

`retrieve_note_context` now provides a neutral context-pack API for note,
selection, and query scopes. It shares current-draft resolution with search and
related notes and returns source/reason/score metadata.

Recommended next step: use `retrieve_note_context` for the first future
chat/inbox context flow instead of adapting search UI results.

### 5. Proposal Core Needs Preview/Review Integration

The backend proposal core validates and applies changes. Frontend proposal
helpers now also build a source-agnostic review model for non-AI preview/review
flows.

Recommended next step: when a UI is added, keep it over the existing proposal
review model and backend apply command.

### 6. `Notepad.svelte` Remains A Large Composition Root

The component is increasingly better organized, but it still wires many
controllers, stores, and DOM concerns in one file. That is acceptable as a
composition root, but risky if new feature policy lands there.

Recommended next step: continue extracting command groups behind
`createNotepadCommands`, especially document lifecycle and split-picker flows.
This was intentionally skipped in the latest pass.

### 7. `editor.ts` Is Still The Largest Frontend Technical Surface

`editor.ts` is necessarily dense because it wraps CodeMirror, but future
features will need selected text, block identity, overlays, and controlled
edits. Those should be exposed as capabilities rather than by importing
CodeMirror objects.

`editorCapabilities.ts` now defines a focused editor capability adapter for
selection, current block, controlled replacement, and disposable read-only
overlays.

Recommended next step: have future editor-aware features depend on this adapter
or `NotepadFeatureHost`, not raw CodeMirror objects.

### 8. `AppState` Still Aggregates Many Backend Concerns

`AppState` owns notes index, lexical index, semantic state, draft cache,
foreground activity, and background indexing queue. That is workable, but it
means backend features often reach through one broad object.

Recommended next step: keep extracting services around specific workflows:
index mutation and document lifecycle remain the next backend/frontend seams to
watch.

## Suggested Next Sequence

1. Backend test baseline: complete.
2. Stale AI docs: complete.
3. Concrete notepad feature host: complete.
4. Semantic retrieval-context API: complete.
5. Document lifecycle command group: intentionally skipped in this pass.
6. Proposal preview/review adapter: complete.

This sequence keeps the editor, semantic retrieval, and proposal systems moving
together instead of hardening them independently.
