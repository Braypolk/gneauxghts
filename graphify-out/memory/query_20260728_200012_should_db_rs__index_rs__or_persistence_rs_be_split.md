---
type: "query"
date: "2026-07-28T20:00:12.313700+00:00"
question: "Should db.rs, index.rs, or persistence.rs be split?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["db.rs", "ensure_schema()", "open_database()", "persistence.rs", "PersistedState", "index.rs", "AppState", "NotesIndex"]
---

# Q: Should db.rs, index.rs, or persistence.rs be split?

## Answer

Expanded from original query via graph vocabulary: [database, schema, semantic, sqlite, index, search, catalog, cache, persistence, state, note, storage]. Assessment: split semantic/db.rs first; at 2998 lines with 89 functions and 22 types it mixes schema and migrations, note and chunk CRUD, ANN persistence, Atlas persistence, edge generation and repair, job tracking, and related-note previews. Preserve semantic::db as a facade and move cohesive stores behind re-exports. Split state/persistence.rs second; at 1350 lines with 60 functions it mixes note file writes and path validation, state SQLite schema and migrations, recents and activity, and pruning and ID resolution. Extract note_files, state_store, note_activity, and pruning while keeping state re-exports stable. Do not broadly split index.rs yet; although 1697 lines, 80 of 84 graph nodes stay in one community and it is cohesive around AppState and NotesIndex. Extract only pure markdown/task parsing helpers and perhaps AppState orchestration when touched. Priority: db high, persistence medium-high, index low-medium.

## Outcome

- Signal: useful

## Source Nodes

- db.rs
- ensure_schema()
- open_database()
- persistence.rs
- PersistedState
- index.rs
- AppState
- NotesIndex