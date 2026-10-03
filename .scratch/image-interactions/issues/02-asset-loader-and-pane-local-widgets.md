# Isolate image widgets per pane and retain previews in source mode

Status: resolved
Type: task
Depends on: 01

## Scope

Replace global cached image DOM with view-owned WidgetType instances and updateDOM/destroy lifecycle. Introduce the injected asset loader described in [the specification](../spec.md), retaining data-URL IPC initially. Share bounded image resources, never DOM or EditorView references. Support decoded bare names and contained assets paths through the backend resolver, with traversal and symlink containment checks.

Implement standalone block rendering and source-plus-preview using directly supplied decorations; use inline handling in prose/list/table contexts. Address asynchronous dimension changes through CodeMirror measurement and stable scroll anchoring. Preserve loading/error/retry presentation.

## Main files

- `images/imageEmbedWidgets.ts`, `images/imageEmbeds.ts`, `images/imageConfig.ts`
- `editor/editorDocumentResources.ts`, `editor/types.ts`
- `src-tauri/src/commands/asset_commands.rs`
- `editor/editor.css` or a narrowly scoped image stylesheet.

## Acceptance

- Identical embeds mount simultaneously in sibling panes and different notes without moving DOM between them.
- Width changes retain each pane's image DOM where possible; destruction releases controllers/observers.
- Source mode keeps a rendered preview and supports changing the target while old reads are pending.
- Cache limits, deduplication, refresh, superseded results, missing assets, and contained-path resolution are tested through the loader seam.
- Click positions and following-line cursor geometry remain correct after load/resize and source visibility changes.

## Comments

Do not add a streamed asset protocol until measurement establishes a need.

## Answer

Replaced shared/global DOM with view-owned widgets and lifecycle cleanup. Shared document resources retain bounded/coalesced asset bytes with fingerprints and retry; Rust canonical containment supports safe subfolders and rejects traversal/symlink escape. Source mode retains the last valid preview; direct block decorations align to the readable column, while inline contexts stay inline. Cache and sibling-pane DOM checks pass.

Evidence: [implementation validation](../validation.md).
