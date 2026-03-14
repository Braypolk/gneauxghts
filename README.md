# Gneauxghts

Gneauxghts is a local-first desktop notes app built with Tauri, SvelteKit, and Rust. It stores plain Markdown files in your `Documents` folder, keeps a live master task list from Markdown checkboxes, and layers semantic search plus a note graph on top without moving your notes into a proprietary database.

## What It Does

- Edit notes in a focused single-note workspace with autosave.
- Save notes as regular Markdown files named from the note title.
- Search the current note or all notes from the bottom command bar.
- Surface recent notes and recent tasks directly from the search UI.
- Build a master task list from Markdown checkboxes like `- [ ]` and `- [x]`.
- Toggle task completion from the list view and jump back to the source note.
- Hide or reorder task groups by note.
- Generate a semantic note graph and blend semantic matches into keyword search.
- Inspect semantic indexing status, model state, and diagnostics from Settings.

## How Notes Are Stored

- Notes live in `~/Documents/Gneauxghts`
- App state lives in `~/Documents/Gneauxghts/.gneauxghts-state.json`
- Notes are plain `.md` files
- File names are derived from the first Markdown heading or first non-empty line

This means your notes stay easy to back up, sync, or edit outside the app.

## Keyboard Shortcuts

- `Cmd+1` opens the main note view
- `Cmd+2` opens Inbox
- `Cmd+3` opens Map
- `Cmd+4` opens List
- `Cmd+,` opens Settings
- `Cmd+F` focuses search in the current note
- `Cmd+Shift+F` switches search to all notes
- `Enter` in the title field jumps into the editor body

## Stack

- Tauri 2
- SvelteKit 2 / Svelte 5
- TypeScript
- Rust
- Milkdown Crepe editor
- SQLite + HNSW-based ANN index for semantic retrieval

## Development

### Prerequisites

- Node.js
- `pnpm`
- Rust toolchain
- Tauri system dependencies for your platform

Install dependencies:

```bash
pnpm install
```

Start the desktop app in development:

```bash
pnpm tauri dev
```

Run the frontend/type checks:

```bash
pnpm check
```

Build a release app:

```bash
pnpm tauri build
```

## Semantic Search And Map

The semantic layer is local-first and optional.

- Notes are still stored as Markdown files.
- Semantic indexing metadata is stored in the app data directory, not inside your note files.
- Search can blend lexical and semantic results.
- The map view renders note-to-note links from semantic similarity.

### Development Runtime Requirements

Semantic features depend on a local `llama-server` runtime in development.

Gneauxghts will look for `llama-server` in this order:

1. A bundled runtime in packaged builds
2. `GNEAUXGHTS_LLAMA_SERVER_BIN`
3. `llama-server` on `PATH`
4. `/opt/homebrew/bin/llama-server`
5. `/usr/local/bin/llama-server`

By default, semantic settings start in a conservative mode:

- `localOnlyMode = true`
- `autoDownloadModel = false`

That means semantic indexing will not download a model automatically unless you change the setting. If you keep local-only mode enabled, place the GGUF model in the app's semantic model cache first. The current implementation is wired for:

- Model repo: `jinaai/jina-embeddings-v5-text-nano-retrieval`
- Expected file: `jina-embeddings-v5-text-nano-retrieval-Q6_K.gguf`

The Settings screen shows the active runtime path, model path, index status, and recent semantic diagnostics.

## Project Structure

```text
src/               Svelte UI, routes, and editor components
src-tauri/         Rust backend, commands, indexing, semantic layer
scripts/tauri.mjs  Wrapper for Tauri CLI build/dev commands
SEMANTIC_BENCHMARK.md
                   Notes on semantic indexing performance work
```

## Current Screens

- `/` main note editor
- `/list` master task list
- `/map` semantic note graph
- `/settings` theme + semantic controls
- `/inbox` placeholder route

## Notes On Behavior

- Autosave writes the current note after short idle periods.
- "Forget" deletes the current saved note after a hold-to-confirm interaction.
- "unForget" restores the most recently forgotten note from in-memory state.
- "Remember" saves the current note and clears the editor so you can start another one.

## License

MIT
