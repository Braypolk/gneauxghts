# Main App Command Ownership Map

Date: 2026-04-22

Scope:
- `src-tauri/src/commands.rs`
- `src-tauri/src/commands/*`
- `src-tauri/src/ai/*` command surface

## Routing Principle

Every command handler should be thin:
1. Validate/normalize args
2. Delegate to one subsystem owner
3. Return domain result (or mapped error string)

## Command -> Owner

| Command | Primary Owner Module | Notes |
|---|---|---|
| `load_note_session`, `open_note`, `read_note` | `commands/note_session.rs` | Session load/open/read flow |
| `save_note`, `remember_note` | `commands/note_persistence.rs` | Persist + index + semantic queue orchestration |
| `resolve_note_link`, `autocomplete_note_links` | `commands/wikilink_commands.rs` | Wikilink resolve/autocomplete |
| `list_recent_notes`, `search_notes`, `search_notes_hybrid`, `get_related_notes` | `commands/search_commands.rs` | Lexical + semantic retrieval paths |
| `list_recent_tasks`, `list_tasks`, `toggle_task`, `delete_task`, task visibility/order commands | `commands/task_commands.rs` | Task view and mutation |
| `forget_note`, `list_forgotten_notes`, `restore_forgotten_notes`, `delete_forgotten_notes` | `commands/forgotten_note_commands.rs` | Forgotten-note lifecycle |
| `read_image_asset_data_url`, `store_pasted_image` | `commands/asset_commands.rs` | Asset read/write |
| `get_graph_data_metadata`, `get_graph_data`, `save_graph_node_positions` | `commands/graph_commands.rs` | Graph metadata/payload and layout persistence |
| semantic status/settings/debug commands | `commands.rs` -> `semantic` state | Thin pass-through to semantic subsystem |
| vault/sync commands | `commands.rs` -> `sync`/`state` | Thin pass-through to sync/state |
| AI settings/models/inbox commands | `ai/mod.rs` -> `ai/approval_service.rs` + `ai/remember_orchestrator.rs` + `ai/store.rs` | Command facade only |

## Shared Internal Command Utilities

Shared index bridges are centralized in:
- `src-tauri/src/commands/index_bridge.rs`

Used by:
- note persistence
- forgotten notes
- wikilink resolution
- task mutation

This keeps cross-cutting index read/write helpers out of `commands.rs`.
