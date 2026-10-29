# Gneauxghts

Gneauxghts is a local-first desktop notes app built with Tauri, SvelteKit, and Rust. It stores plain Markdown files in a vault (by default in your `Documents` folder), keeps a live master task list from Markdown checkboxes, and layers semantic search on top without moving your notes into a proprietary database.

## What It Does

- Edit notes with autosave and split panes for notes and chats.
- Save notes as regular Markdown files named from the note title.
- Search the current note or all notes from the bottom command bar.
- Surface pinned notes and recent note/chat locations directly from the search UI.
- Build a master task list from Markdown checkboxes like `- [ ]` and `- [x]`.
- Toggle task completion from the list view and jump back to the source note.
- Insert fixed local date/time text with slash commands, edit date/time chips,
  and set portable [task deadlines](docs/features/dates.md).
- Hide or reorder task groups by note.
- Blend semantic matches into keyword search.
- Chat with a vault-aware note agent using hosted OpenAI or a local model
  served through an OpenAI-compatible endpoint such as LM Studio.
- Stream answers and optional provider reasoning, inspect tool activity, and open cited notes.
- Inspect semantic indexing status, model state, and diagnostics from Settings.

## How Notes Are Stored

- The default vault is `~/Documents/Gneauxghts`; choose another in Settings.
- Notes are plain `.md` files
- File names use the explicit note title, falling back to the first non-empty body line.
- Vault-local durable state and caches live in a portable `.gneauxghts`
  directory inside the vault. A representative layout is:

  ```
  MyVault/
    Notes.md
    Projects/Example.md
    assets/pasted-image.png
    .forgotten/old-note.md
    .gneauxghts/
      vault.json            # vault identity, schema/version, timestamps
      app-state.sqlite3     # recents, task view state, forgotten-note metadata
      history.sqlite3       # note identities, revisions, Editing Windows, recovery
      ai.sqlite3            # access policy, provider configuration, drafts, publication receipts
      pi-chat.sqlite3       # Pi conversations, history, tasks and compaction
      atlas-map/            # durable Atlas identities, names, accepted geometry
      cache/                # derived search and Atlas caches
  ```

- Semantic SQLite stores and caches also live under `.gneauxghts`, with names
  scoped to the active embedding representation and platform. Older vaults may
  retain a legacy `semantic.sqlite3`. The current path selection is in
  [the semantic owner](src-tauri/src/semantic/mod.rs).
- Provider API keys live in the operating system credential store outside the
  vault (macOS Keychain on macOS).
- Device-specific model and runtime files stay global under app data.
- Pi keeps conversation history, provider reasoning, tool payloads and execution
  state in its vault-local database. Native access policy, provider settings,
  unsent drafts and future-write publication receipts remain in ai.sqlite3.
- Opening a vault creates missing `.gneauxghts` scaffolding and reopens existing
  compatible stores. There is no import from older global app-data databases.
- Switching the vault directory takes effect on the next launch; the newly
  selected vault's `.gneauxghts` layout is scaffolded immediately.

Notes can be edited outside the app. To copy or move the complete vault, close
the app cleanly first and include `.gneauxghts`, assets, and `.forgotten`. Copying
live SQLite main files alone is not a supported backup. Credentials and local
model/runtime installations remain device-local.

## Thought Partner and Vault Privacy

New vaults allow the thought partner to search all ordinary notes by default.
Choose Full vault or No notes in the composer, and exclude individual notes in
Settings. Exclusions use stable Note Identities, override conversation scope and
survive note renames. Restricting access starts a fresh model context; previous
history remains available for human inspection.

The agent reads canonical saved notes through native search/read tools. Mention
a note in chat when it is relevant; the composer has no attachment picker. It
does not implicitly share the adjacent editor or unsaved text. Source citations
open the note, with an exact passage selected when one was supplied and remains
unambiguous. Search previews alone cannot authorize citations. See the
[behavior invariants](docs/architecture/behavior-invariants.md#chat) for admission
and retained-history boundaries.

Initial chat is read-only. Native create/update authorization and reviewed
publication are a tested foundation for future write features; model mutation
tools and review UI are not yet exposed. Hosted inference uses OpenAI Responses.
Local inference uses the configured OpenAI-compatible endpoint and never falls
back to hosted OpenAI. LM Studio's default endpoint is
http://localhost:1234/v1.

Pi owns execution, queueing, Stop, persisted history, recovery and automatic
compaction. Compaction reduces model context while preserving human history;
earlier reads and summaries remain historical working memory, so current-state
claims require another note read. Terminal failures offer New attempt.
Forgetting a conversation hides it from the list and offers Undo; it does not
permanently delete its history.

## Optional tags

Open the note’s **⋯** menu and choose **Show tags** to add, edit, or remove tags
at the top of the note, scrolling with its content. Tags are hidden by default;
the visibility preference applies to every note and pane and survives restart.
Selecting a chip edits that tag in place on this note only. Tags live in the Markdown file’s YAML frontmatter, for example
`tags: [renovation, budget]`, and use the same autosave and history as the body.
Other frontmatter properties are preserved.

In **All notes** search or Atlas, use `tag:renovation` or `#renovation` to match
that exact tag. Add words to search within tagged notes, such as
`#renovation contractor estimates`; multiple tags require all of them.
Ordinary searches also match tag names, with a small relevance contribution.
Tags ignore case and support letters, numbers, hyphens, underscores, and `/`.
Body hashtags remain ordinary text rather than adding frontmatter tags.

Atlas keeps its semantic layout. Tag searches highlight matching notes in place.

## Keyboard Shortcuts

These are the default macOS bindings; shortcuts can be customized in Settings.

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

## Images

Images in notes support both `![[photo.png|200]]` and
`![Caption|200](assets/photo.png "Optional title")`, including local Markdown
reference images. Files resolve within the vault's `assets` folder; encoded
spaces and contained subfolders work.

Hover for Zoom and source controls. Click an image once to select it for deletion
or editing; click it again to open the note's image gallery. Arrow keys also select
an image, and Space or Zoom opens the gallery directly. Enter reveals editable Markdown with
its preview, and Tab targets the width. On a selected image, `+` / `=` / `-` change
width by 50 pixels, `0` clears the size, and a corner drag resizes proportionally.
Backspace/Delete remove the embed; Cmd/Ctrl-C and Cmd/Ctrl-X copy/cut its Markdown.
These edits share the note's undo history and never delete the asset file.

In the viewer, Left/Right browse images, `+` / `=` / `-` zoom, `0` fits, dragging pans,
and Escape returns to the originating editor position. Failed clipboard imports
retain selected text and offer Retry/Cancel; retry reuses files already saved.

## Stack

- Tauri 2
- SvelteKit 3 / Svelte 5
- TypeScript
- Rust
- CodeMirror 6 editor
- SQLite + HNSW-based ANN index for semantic retrieval
- Pi Durable, Pi AI and Chord 1.3.0 for chat execution and persistence
- Native Rust adapters for WebView storage, transport, vault authority and publication

## Development

The ownership map, canonical write paths, and runtime seams are documented in
[ARCHITECTURE.md](ARCHITECTURE.md). The Pi runtime ownership decision is recorded in
[ADR 0012](docs/adr/0012-found-ordinary-chat-on-pi.md).

### App icons

The original artwork lives in `static/logo-light.svg` and `static/logo-dark.svg`.
Run `pnpm icons:generate` with ImageMagick (`magick`) installed to regenerate native
icons and the iOS asset catalog. Settings → Appearance → App logo offers Auto,
Light, and Dark independently of the interface theme. Auto is the default and
follows the system appearance. The running desktop icon and browser favicon use
this choice; iOS Home Screen appearance is managed by the system asset catalog.
The generator adds transparent padding and a subtle rim highlight for macOS.
Both the bundled ICNS and the running Dock icon use this composition; the web,
Windows, Linux and iOS artwork uses the original full-canvas composition.

### Animation iteration

Run `pnpm animation:lab` and open <http://127.0.0.1:1423/__animation-lab/> for
inventory-based Search/Related/Chat and pane animation previews, frame scrubbing,
A/B comparisons, and editable motion values. See [the animation lab guide](docs/features/animation-lab.md).

### Prerequisites

- Node.js 22.17 or newer (CI uses Node 24)
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

Desktop builds bundle the current Node runtime for ChatGPT sign-in, including
its license notices. If a custom Node installation stores those notices elsewhere,
set `GNEAUXGHTS_NODE_LICENSE` to that distribution's license file.

Run the frontend/type checks:

```bash
pnpm check
```

Build a release app:

```bash
pnpm tauri build
```

On macOS, local development, release builds and rebundling use the certificate
selected in the gitignored `.gneauxghts-signing.local.json` (`{"identity":"<certificate fingerprint>"}`),
unless explicit signing credentials or `--no-sign` are supplied. A stable
certificate lets Keychain recognize subsequent builds; ad-hoc builds can request
credential access again after each rebuild. Reinstalling the app retains its
saved settings and Keychain credentials.

For notarized distribution, use `pnpm release:mac` with explicit Developer ID
signing and notarization credentials. That command does not use the local
development certificate.

Development and test builds use packed debugging symbols. On macOS this keeps
full debug information in `.dSYM` bundles instead of leaving new loose object
files in `target/debug/deps` after every incremental rebuild. Incremental
compilation remains enabled; symbol packing adds a little linking time.

Run `pnpm test:build:artifacts` on macOS to verify that repeated edits, builds,
and tests keep dependency output stable. Cargo still retains artifacts from
old dependency, feature, and toolchain combinations. To discard the debug
output between development milestones, stop development builds and run
`pnpm clean:rust:debug`. This preserves release apps and installers, but removes
ordinary debug executables, which must be rebuilt before running them again.
The separately pinned native E2E copies remain; rebuild those whenever their
source changes.

### iOS simulator builds

For the experimental iOS app, install the matching Xcode simulator runtime and
build with Xcode's normal signing enabled:

```bash
pnpm tauri ios build --debug --target aarch64-sim --ci
```

The wrapper stages the pinned semantic framework before building. Install the
resulting `src-tauri/gen/apple/build/arm64-sim/Gneauxghts.app` with `xcrun simctl
install <simulator-udid> <app-path>`.

Keychain tests require this signed build path. `--no-sign` omits Xcode's
simulator application identity; manually signing that output afterward does
not restore the embedded simulator entitlements. Xcode uses its local
simulator signature without a device provisioning profile. Physical iPhone
and distribution builds still require appropriate signing and provisioning.
See the bounded [Keychain validation](.scratch/mobile-ios-readiness/keychain-validation.md).

## Semantic Search

The semantic layer is local-first and optional.

- Notes are still stored as Markdown files.
- Semantic indexes and derived caches are vault-local under `.gneauxghts`.
- Search can blend lexical and semantic results.

### In-app setup

Open **Settings → Search → Set up local search**. On supported platforms, the
current default embeds text and images with EmbeddingGemma 2 through a native
LiteRT runtime loaded in-process. Setup installs missing runtime/model artifacts
in device-local app data, prepares the engine, and schedules indexing. Keyword
search remains available during setup, and interrupted downloads can be retried.
Downloads use pinned artifacts and checksum verification; setup needs no Python
installation or terminal commands.

Read [the native installer](src-tauri/src/semantic/litert_install.rs) for current
platform support, artifact sources, and pins, and
[the Gemma provider](src-tauri/src/semantic/litert.rs) for engine preparation.
Unsupported platforms without an existing legacy index retain keyword search.

### Legacy recovery

Jina through `llama-server` remains available for explicitly staged next-launch
recovery, and for unsupported Gemma platforms with an existing legacy index.
`GNEAUXGHTS_LLAMA_SERVER_BIN` and Jina GGUF cache overrides belong to that legacy
provider; they do not configure the default Gemma engine. Consult
[provider selection](src-tauri/src/semantic/mod.rs),
[the retained Jina provider](src-tauri/src/semantic/legacy_jina.rs), and
[the legacy runtime installer](src-tauri/src/semantic/runtime_install.rs) before
using those paths.

Settings shows the active provider's runtime/model state, index status, and
recent semantic diagnostics.

## Project Structure

```text
src/               Svelte UI, routes, and editor components
src-tauri/         Rust backend, commands, indexing, semantic layer
scripts/tauri.mjs  Wrapper for Tauri CLI build/dev commands
docs/features/     Current Atlas and date/deadline behavior
docs/adr/          Architecture decisions and their current scope
```

## Current Screens

- `/` main note editor
- `/list` master task list
- `/map` note atlas
- `/settings` appearance, shortcuts, vault/recovery, chat, and search controls

## Notes On Behavior

- Autosave writes the current note after short idle periods.
- **Forget** moves a saved note into `.forgotten` with durable recovery metadata
  and retained history. Depending on Settings, it uses a confirmation popup,
  hold-to-skip confirmation, or immediate action. Retention and recovery controls
  are in Settings.
- **unForget** restores the latest forgotten note during the current session;
  saved forgotten notes also remain recoverable through Settings across restarts
  until purged or expired.
- **New Idea** starts or reuses an empty draft in the invoking pane. Ordinary
  edits are saved before departure; protected proposal reviews await Keep or
  Undo. Other panes keep their current note or chat.

Ordinary chat uses the shared Pi Durable/Pi AI/Chord runtime on desktop and iOS. The [completed rebuild](.scratch/archive/pi-chat-rebuild.md) records the approved scope and desktop/simulator acceptance. Initial model tools support note search and reads; native create/update authority is a tested foundation for future write features. Physical-device and live hosted-provider acceptance remain deferred.
