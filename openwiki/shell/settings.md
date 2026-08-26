---
type: application shell
title: Shell and settings
description: Route composition, startup bootstrap, persisted preferences, vault selection, theme, shortcuts, and semantic controls owned by the Svelte shell.
tags: [shell, settings, bootstrap, preferences]
---
# Shell and settings

`src/routes/+layout.svelte` is the frontend composition root. It applies the theme/mobile shell and starts `appStore.bootstrap()` once; the root route mounts the Notepad workspace, while `/list`, `/map`, and `/settings` expose task, atlas, and configuration surfaces. Rust remains the authority for vault and durable application state; this page covers the client-side coordination around that authority.

## State and configuration

`src/lib/appSettings.svelte.ts` and `src/lib/features/settings/store.svelte.ts` hold reactive settings used by the shell and feature adapters. Settings include the active vault and vault switching flow, semantic/indexing controls, excluded-note configuration, and refresh/diagnostic actions. Treat values returned by Tauri as authoritative after bootstrap; changing the vault is a lifecycle operation, not merely a route change, because backend state and watcher ownership must be restarted or reloaded.

`src/lib/theme.svelte.ts` owns theme preference and DOM application. `src/lib/keyboardShortcuts.svelte.ts` centralizes shortcut registration and user-facing bindings. These are presentation/runtime preferences and must not be confused with Markdown note data or vault-local AI secrets. The IPC ownership and payload fixtures are documented in [the IPC contract](../architecture/ipc-events-contract.md); vault state and store locations are documented in [vault persistence](../vault/persistence-and-recovery.md).

## Routes and change points

| Intent | Canonical surface | Related validation |
| --- | --- | --- |
| Change startup or route composition | `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/*/+page.svelte` | shell/bootstrap tests and `src/lib/architectureFitness.test.ts` |
| Add or change a preference | `appSettings.svelte.ts`, settings store, corresponding Tauri adapter | settings store tests and IPC fixture tests |
| Change appearance or shortcuts | `theme.svelte.ts`, `keyboardShortcuts.svelte.ts` | theme/editor/shortcut-focused tests |
| Change search/index controls | settings store plus semantic command adapter | semantic diagnostics and search tests |

The shell should surface backend failures rather than silently converting them into successful preference changes. On startup, bootstrap ordering matters: app state must be available before feature stores attempt to load notes, tasks, search metadata, or chat settings. See the [end-to-end workflows](../workflows/end-to-end.md) for the startup and vault-switch sequence.

## Scope and gaps

Generic reusable components are intentionally not catalogued here. The repository has focused client tests for settings-adjacent state and architecture contracts, but platform-specific vault selection and full restart behavior should be validated with the desktop E2E mode described in [development and testing](../operations/development-and-testing.md).
