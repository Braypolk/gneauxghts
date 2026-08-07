# Gneauxghts

Gneauxghts is a local-first desktop notes app built with Tauri, SvelteKit, and Rust. It stores plain Markdown files in your `Documents` folder, keeps a live master task list from Markdown checkboxes, and layers semantic search on top without moving your notes into a proprietary database.

## What It Does

- Edit notes in a focused single-note workspace with autosave.
- Save notes as regular Markdown files named from the note title.
- Search the current note or all notes from the bottom command bar.
- Surface recent notes and recent tasks directly from the search UI.
- Build a master task list from Markdown checkboxes like `- [ ]` and `- [x]`.
- Toggle task completion from the list view and jump back to the source note.
- Hide or reorder task groups by note.
- Blend semantic matches into keyword search.
- Chat with a vault-aware note agent using hosted OpenAI or a local model
  served through an OpenAI-compatible endpoint such as LM Studio.
- Review every AI-prepared note update or creation before it is written.
- Inspect semantic indexing status, model state, and diagnostics from Settings.

## How Notes Are Stored

- Notes live in `~/Documents/Gneauxghts`
- Notes are plain `.md` files
- File names are derived from the first Markdown heading or first non-empty line
- Vault-local durable state and caches live in a portable `.gneauxghts`
  directory inside the vault, so a vault folder is self-contained and movable:

  ```
  MyVault/
    Notes.md
    Projects/Example.md
    assets/pasted-image.png
    .forgotten/old-note.md
    .gneauxghts/
      vault.json            # vault id + schema/version + timestamps
      app-state.sqlite3     # recents, hidden/order/collapsed, forgotten meta
      semantic.sqlite3      # semantic index store
      ai.sqlite3            # AI jobs / proposals / history + provider config
      cache/                # rebuildable caches
        hnsw.snapshot       # ANN graph snapshot (+ hnsw.vectors / manifest)
        lexical/            # reserved for the lexical index
  ```

- Secrets (provider API keys) are **never** written into the portable vault.
  They live in a machine-global secret store (`secrets.sqlite3`) under the OS
  app-data directory, so moving or sharing a vault cannot leak credentials.
- Large, device-specific model files stay global under app data as well.
- Chat history, provider/model metadata, note access policies, and unresolved
  proposals live in the vault-local `ai.sqlite3`. Provider reasoning and
  historical tool payloads are not stored.
- Each vault starts fresh: opening a vault scaffolds a new `.gneauxghts`
  layout in place. There is no import from older global app-data databases.
- Switching the vault directory takes effect on the next launch; the newly
  selected vault's `.gneauxghts` layout is scaffolded immediately.

This means your notes stay easy to back up or edit outside the app, and the
whole vault (notes + index + state) travels as one folder.

## Thought Partner and Vault Privacy

New vaults allow the thought partner to search all ordinary notes by default.
You can switch a conversation to approved-notes-only or no-vault access, and
exclude individual notes by stable note ID. Exclusions override every
conversation scope and survive note renames.

Before each message, Gneauxghts saves the adjacent active note and gives the
agent its current snapshot when policy permits. Explicit wikilinks are resolved
locally. Search, note reads, citations, and proposed changes all pass through
the same backend policy checks.

The agent may search and read allowed notes, but it cannot write them directly.
Updates and new notes are durable proposals that require Keep; Undo dismisses
them. Hosted OpenAI requests go only to OpenAI. Local requests go only to the
configured OpenAI-compatible endpoint, and local conversations never fall back
to hosted OpenAI. LM Studio's default endpoint is
`http://localhost:1234/v1`.
When the selected model supports it, the composer also accepts files from the
paperclip button and images pasted from the clipboard. Attachments are stored
with the local chat record so they remain available after reopening or retrying
a conversation.

## Keyboard Shortcuts

- `Cmd+1` opens Map
- `Cmd+2` opens the main note view
- `Cmd+3` opens List
- `Cmd+,` opens Settings
- `Cmd+F` focuses search in the current note
- `Cmd+Shift+F` switches search to all notes
- `Cmd+T` opens the thought partner in the current pane
- `Cmd+Shift+N` opens the split pane options
- `Cmd+Shift+T` opens a new thought partner chat in a split pane
- `Cmd+L` opens the previous note or chat location in the current pane
- `Cmd+Shift+L` opens the previous note or chat location in a split pane
- `Enter` in the title field jumps into the editor body

## Stack

- Tauri 2
- SvelteKit 2 / Svelte 5
- TypeScript
- Rust
- CodeMirror 6 editor
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

## Semantic Search

The semantic layer is local-first and optional.

- Notes are still stored as Markdown files.
- Semantic indexing metadata is stored in the app data directory, not inside your note files.
- Search can blend lexical and semantic results.

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
- `/map` note atlas
- `/settings` theme, forget button, and semantic controls

## Notes On Behavior

- Autosave writes the current note after short idle periods.
- "Forget" deletes the current saved note either immediately or after a configurable hold-to-confirm interaction.
- "unForget" restores the most recently forgotten note from in-memory state.
- "Remember" saves the current note and clears the editor so you can start another one.

