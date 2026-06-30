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

- `wikilinks/wikilinks.ts`: editor decorations;
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

The current proposal system is a foundation layer, not a user-facing inbox.

Current capabilities:

- represent update/create/delete note changes;
- validate content hashes before writes;
- apply changes through Rust;
- update indexes after apply;
- expose frontend preview/review helper types.

Key files:

- backend: `src-tauri/src/proposals.rs`;
- command: `src-tauri/src/commands/proposal_commands.rs`;
- frontend types: `src/lib/types/proposals.ts`.

Future AI inbox and AI chat should both use this proposal system for note
mutations.

## Retrieval Context

`retrieve_note_context` returns context packs for `note`, `selection`, and
`query` scopes. It preserves current-draft handling and returns source labels,
reasons, scores, and line metadata. Future chat/inbox features should use this
instead of depending on search or related-note UI result shapes.
