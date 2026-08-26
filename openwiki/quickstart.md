---
type: wiki entrypoint
title: Gneauxghts developer wiki
description: A source-grounded navigation guide for safely changing the local-first Tauri Markdown notes application.
tags: [quickstart, architecture, development]
---
# Gneauxghts developer wiki

Gneauxghts is a local-first desktop Markdown notes app: Svelte UI calls a Rust Tauri backend that owns canonical vault files, sidecar state, indexing, watching, and the thought-partner runtime. Start with [architecture](architecture/overview.md), then choose the owner of the behavior you intend to change.

## Map

- [Architecture](architecture/overview.md) — composition roots, routes, state owners, canonical versus derived data.
- [IPC and events](architecture/ipc-events-contract.md) — public Tauri command/event surface and compatibility procedure.
- [Document workspace](notepad/document-workspace.md) — panes, CodeMirror, navigation, autosave, conflicts, task/proposal interaction.
- [Vault persistence](vault/persistence-and-recovery.md) — Markdown, frontmatter, SQLite sidecars, assets, watcher, forget/restore, integrity boundaries.
- [Tasks and navigation](tasks-and-navigation.md) — checkbox projection/mutation, task List, navigation, wikilinks.
- [Search, semantic indexing, and atlas](search/semantic-and-atlas.md) — lexical/hybrid retrieval, embeddings/ANN, related notes, atlas, exclusion scope.
- [Thought partner](ai/thought-partner.md) — providers, secrets, permissions, context, streaming, citations, attachments, reviewed writes.
- [Shell and settings](shell/settings.md) — routes, bootstrap, preferences, vault selection, theme, shortcuts, and diagnostics.
- [End-to-end workflows](workflows/end-to-end.md) — startup, external changes, tasks, indexing, and reviewed AI traces.
- [Operations](operations/development-and-testing.md) — setup, tests, debugging, packaging, release and wiki automation.
- [Documentation drift](documentation-drift.md) — conflicts, documented-only claims, and unproven guarantees.

## Task routing

| Intent | Read first | Main source ownership | Focused test / minimum validation |
| --- | --- | --- | --- |
| Change editor/autosave/panes/conflict UI | [Document workspace](notepad/document-workspace.md) | `Notepad.svelte`, `document/*`, `workspace/*`, `orchestration/*` | focused `pnpm test` document/pane suite; `pnpm test:e2e:browser` for lifecycle |
| Change save, filename, Markdown/frontmatter, watch, forget/restore | [Vault persistence](vault/persistence-and-recovery.md) | `state/persistence.rs`, `note.rs`, watcher, forgotten commands | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Change checkboxes/list/task mutation | [Tasks and navigation](tasks-and-navigation.md) | task projection/mutation services, task store | task TS tests plus Cargo task tests |
| Add/change a Tauri command or event | [IPC and events](architecture/ipc-events-contract.md) | `lib.rs` registration, command module, event bus, TS adapter | `ipcFixtures.test.ts` + consumer and Cargo tests |
| Change semantic/hybrid search, related, map | [Search and atlas](search/semantic-and-atlas.md) | `lexical.rs`, `semantic/*`, search/atlas commands/stores | semantic Cargo tests and relevant TS store tests |
| Change providers, AI permissions, streaming, proposal commits | [Thought partner](ai/thought-partner.md) | `chat.rs`, `agent_runtime.rs`, `agent_tools.rs`, proposal commands | chat/proposal tests; provider integration is a known gap |
| Change routes, preferences, theme, shortcuts, vault selection | [Shell and settings](shell/settings.md) | `+layout.svelte`, `appSettings.svelte.ts`, settings store, theme/shortcuts modules | settings/bootstrap tests; `pnpm check` |
| Trace a cross-system lifecycle or failure | [End-to-end workflows](workflows/end-to-end.md) | composition roots, watcher, task mutation, indexer, chat/proposal commands | focused domain tests plus IPC fixtures |
| Change build, runtime package, release, E2E | [Operations](operations/development-and-testing.md) | manifests, `build.rs`, Tauri config, scripts, E2E configs | `pnpm check`; target build/native test as appropriate |

## Non-negotiable working model

1. Markdown is canonical note content. Treat projections/indexes as derived unless their page says otherwise.
2. Do not let async completion overwrite a newer document revision, pane transition, conflict ID, or chat event sequence.
3. Dirty editor text must not be overwritten by watcher/task/backend changes; use the documented conflict/prepare paths.
4. A proposal stages content; it becomes a note write only after review/commit.
5. AI exclusions are an AI access boundary, not an owner-search visibility feature.
6. A canonical save with `commitWarning` has committed Markdown; diagnose/repair derived state rather than redoing the write.

## Backlog

No substantial repository area is deferred. Evidence gaps are recorded rather than guessed: real OS watcher lifecycle, crash/power-loss durability, symlink containment, live provider/keyring integration, structured web citations, and full proposal recovery. See [documentation drift](documentation-drift.md).