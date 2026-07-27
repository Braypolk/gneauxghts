# Feature Map

This document summarizes the user-facing features and the code paths that
support them.

## Main Notepad

The main route is `src/routes/+page.svelte`, which renders
`src/lib/features/notepad/Notepad.svelte`.

Primary capabilities:

- edit markdown notes;
- split the workspace into two panes;
- switch panes between editor and placeholder chat mode;
- autosave notes;
- restore recently forgotten notes;
- open recent notes and recent tasks;
- search current/all notes;
- view related notes;
- follow and autocomplete wikilinks;
- paste and render local image embeds.

Important implementation areas:

- document state: `state/noteStore.ts`;
- document/pane synchronization: `document/*`;
- editor lifecycle: `editor/editorLifecycleController.ts`;
- CodeMirror runtime: `editor/editor.ts`;
- workspace layout: `workspace/*`;
- notepad commands: `orchestration/*`;
- search/related stores: `search/*`, `related/*`;
- wikilinks: `wikilinks/*`;
- images: `images/*`.

## Markdown Editor

The editor is CodeMirror-backed and keeps markdown as the source of truth.
Markdown is rendered in place with CodeMirror decorations rather than converted
to a separate HTML preview.

Key behaviors:

- markdown syntax highlighting for fenced code;
- visual styling/concealment for headings, emphasis, links, lists, tasks,
  blockquotes, code blocks, and horizontal rules;
- block handles and block movement;
- slash menu for block type changes;
- passive table styling;
- image embed widgets;
- wikilink decorations/autocomplete.

Extension guidance:

- add rendering concerns under `notepad/markdown` when possible;
- add editor commands through focused editor modules or the feature host;
- avoid adding feature-specific logic directly to `editor.ts`.

## Search and Recents

Search combines lexical and semantic signals.

Frontend:

- `search/store.svelte.ts` owns search state, debounce, recent notes, and recent
  tasks.
- `search/search.ts` calls Tauri commands.
- `BottomBar.svelte` displays the interaction surface.

Backend:

- `search_commands.rs` handles IPC and result merging;
- `search.rs` scores per-note lexical matches;
- `lexical.rs` maintains the lexical index;
- `index.rs` owns the in-memory note index and current-draft cache;
- `current_document.rs` resolves unsaved current draft bodies.

## Semantic Related Notes

Related notes are semantic-first and depend on the semantic index.

Frontend:

- `related/store.ts` schedules and caches related-note requests.
- `RelatedPanel.svelte` renders desktop/mobile related UI.

Backend:

- `semantic/related.rs` implements related-note retrieval.
- `semantic/mod.rs` exposes semantic availability, settings, and runtime status.
- `semantic/debug.rs` records metrics used by Settings.

Failure model:

- semantic disabled/unavailable returns an explicit unavailable response;
- insufficient current content returns an insufficient-content response;
- editor/search remain usable without semantic results.

## Tasks

Tasks are parsed from markdown task list items and projected into SQLite for
list views and task mutations.

Frontend:

- `routes/list/+page.svelte`;
- `features/tasks/taskListStore.ts`;
- `taskNavigation.ts` for opening a task target in the editor.

Backend:

- `commands/task_commands.rs`;
- `state/task_projection.rs`;
- `index.rs` task parsing helpers.

Task mutations write back to markdown and then queue semantic/index updates.

## Wikilinks

Wikilinks support note/section lookup and autocomplete.

Frontend:

- `markdown/wikilinkExtension.ts`: wikilink syntax nodes;
- `markdown/decorations/wikilinks.ts`: alias concealment and visual styling;
- `wikilinks/wikilinks.ts`: editor interaction and active-link tracking;
- `wikilinks/state.ts`: state and draft-aware lookup request shaping;
- `wikilinks/runtime.ts`: interaction controller;
- `WikilinkAutocomplete.svelte`: UI.

Backend:

- `commands/wikilink_commands.rs`;
- `index.rs` and `search.rs` for note/section lookup.

## Images

Image embeds use markdown-style local references and vault assets.

Frontend:

- `images/imagePaste.ts`;
- `images/imageEmbeds.ts`;
- `images/imageEmbedWidgets.ts`;
- `images/imageEmbedParser.ts`.

Backend:

- `commands/asset_commands.rs`.

## Settings

Settings cover vault location, semantic indexing, forgotten notes, and keyboard
shortcuts.

Frontend:

- `routes/settings/+page.svelte`;
- `features/settings/store.ts`;
- `SemanticSettingsPanel.svelte`;
- `ForgottenNotesPanel.svelte`;
- `KeyboardShortcutsPanel.svelte`.

Backend:

- semantic settings/status/debug commands in `commands.rs`;
- settings service in `services/settings_service.rs`;
- vault configuration in `state/config.rs`.

## Proposals

Note-change proposals are backend-authored, durable review records. The vault
agent can prepare updates and creations, but it cannot write either kind
directly.

Current capabilities:

- represent update and create note changes from Chat;
- validate content hashes before writes (OCC);
- validate exact update anchors or explicit append/prepend boundaries, and
  require the target to have been surfaced by a read tool in the current run;
- persist unresolved proposals in `ai.sqlite3` and reload them with a
  conversation;
- treat an unresolved proposal as the note's unapproved working copy, so later
  runs read it, fold new edits into it, and replace the review with one combined
  diff against the saved note;
- apply reviewed Markdown through `commit_agent_proposal`;
- update indexes after apply;
- recalculate a unique filename when a creation is kept, never overwriting an
  existing note;
- show pending proposals automatically with Keep / Undo controls.

Preview never writes a file. Keep performs a final policy/OCC check and one
atomic note write. Undo resolves the durable proposal without touching disk.

Key files:

- backend: `src-tauri/src/proposals.rs`;
- commands: `src-tauri/src/commands/proposal_commands.rs`
  (`commit_agent_proposal`, `dismiss_agent_proposal`);
- agent tools: `src-tauri/src/agent_tools.rs`;
- frontend types: `src/lib/types/proposals.ts`;
- review feature: `src/lib/features/proposals/` (session, diff model, chat card,
  CodeMirror review extension, orchestration).

The legacy fenced-proposal protocol is removed. AI proposal producers must use
the typed backend tools so policy, target provenance, hashes, and persistence
remain authoritative.

## Vault Agent

Chat runs through the Gneauxghts-owned `AgentRuntime` boundary over
`rig-core`. Hosted OpenAI and local OpenAI-compatible models share one
normalized conversation history and one typed tool surface:

- `get_active_note`
- `search_notes`
- `read_note`
- `propose_note_edits`
- `propose_create_note`

Runs permit at most six model calls and two invalid-tool-call retries. Read
tools may execute concurrently; proposal staging is serialized. The frontend
receives text deltas, compact activity events, citations, and durable proposal
events, never reasoning traces.

Chat attachments are capability-gated per provider/model. Hosted OpenAI uses a
conservative multimodal model allowlist. The standard OpenAI-compatible model
listing does not advertise vision capability, so local models conservatively
accept text files but not images or PDFs. Supported text files are decoded
locally, while hosted-model images and PDFs are passed through Rig's typed
multimodal message content. Attachments are limited to 10 items, 10 MB each,
and 25 MB total per message.

Clicking a pending or sent attachment opens a local in-app preview. Images
expand to fit the viewer, PDFs use the embedded document viewer, and text/code
is rendered as escaped plain text. Opening a preview does not make another
provider request.

Durable update proposals open their target note in the editor immediately and
install editable CodeMirror review hunks over the proposed body. The review
survives switching between Chat and the note; Keep commits through the durable
proposal record, while Undo restores the saved body and dismisses the proposal.

New settings rows default to full-vault access. Existing access settings are
preserved, with legacy `limited` values migrated to `approved`. Stable-ID note
exclusions override full and approved access for active context, retrieval,
reads, citations, and proposals.
AI Settings includes a searchable Excluded Notes manager for adding entries,
reviewing the complete list, and restoring notes to their selected vault scope.

## Retrieval Context

`retrieve_note_context` returns context packs for `note`, `selection`, and
`query` scopes. It preserves current-draft handling and returns source labels,
reasons, scores, and line metadata. Chat's `search_notes` tool and the Tauri
retrieval command use the same policy-aware hybrid backend service, with
lexical fallback when semantic retrieval is unavailable.
