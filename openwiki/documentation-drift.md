---
type: documentation status
title: Documentation drift and evidence limits
description: Confirmed discrepancies between repository documentation and implementation, documented-only claims, and unresolved evidence boundaries.
tags: [documentation, drift, limitations]
---
# Documentation drift and evidence limits

This page records discrepancies rather than silently reconciling them. Source and tests are current evidence; README, PRODUCT, and historical architecture prose are supporting context only.

## Contradicted by implementation

| Existing statement | Implemented behavior | Evidence |
| --- | --- | --- |
| README says semantic metadata is app-data-only | `semantic.sqlite3` is vault-local at `<vault>/.gneauxghts`; only model cache is global | `semantic/mod.rs`, `state/config.rs` |
| README shows one `hnsw.snapshot` and lexical disk index | ANN uses versioned chunk and note generations/manifests; Tantivy lexical index is RAM-only and `cache/lexical` is reserved | `semantic/ann*.rs`, `lexical.rs`, `state/config.rs` |
| README names `autoDownloadModel` setting | current `SemanticSettings` has semantic enabled, local-only, lexical weight, semantic weight; no such setting | `semantic/mod.rs` |
| README calls secrets `secrets.sqlite3` in OS app data | provider keys use Tauri keyring store; code does not establish that SQLite file | `secrets.rs`, `lib.rs` |
| README says provider reasoning and historical tool payloads are not stored | non-text agent events persist; active snapshot body can persist in run data. Raw provider reasoning is intentionally suppressed | `chat.rs`, `agent_runtime.rs` |
| E2E README presents browser layer as primary for proposals/external conflicts/chat runtime | current browser spec only covers note isolation and scroll restoration | `e2e/specs/browser/document-and-pane.spec.ts` |
| `app/events.rs` comment says listeners are in `Notepad.svelte` | current app-level listener centralization is `appStore.svelte.ts` then session lifecycle | `appStore.svelte.ts`, `notepadSessionLifecycle.ts` |

## Documented-only or not confirmed

- README’s current-screen and local-first high-level claims broadly match source, but it is not a test specification.
- The README says “Forget” may delete immediately or via a configurable hold-to-confirm interaction and “unForget” restores most recently forgotten in memory. Current implementation is a `.forgotten` retention workflow with settings-managed list/restore/delete; do not rely on this old UI description.
- Documentation refers to cache layout as stable, but lexical cache persistence is explicitly not implemented.

## Implemented behavior missing or under-described elsewhere

- One shared CodeMirror state/history per document key across panes, stale operation/revision suppression, and dirty external-change conflict recovery are implementation-defined in [document workspace](notepad/document-workspace.md).
- Canonical-first save may return a committed warning rather than retryable failure; watcher self-event matching verifies expected hash/absence; periodic reconciliation backs up OS watcher behavior. See [vault persistence](vault/persistence-and-recovery.md).
- User search visibility differs from AI exclusion policy; Atlas has versioned stale-while-rebuild artifacts. See [search and atlas](search/semantic-and-atlas.md).
- Chat has no provider fallback, durable no-write proposals, static capabilities, heuristic web URLs, and attachments persisted in chat SQLite. See [thought partner](ai/thought-partner.md).

## Ambiguous or bounded guarantees

Source does not establish encryption at rest, parent-directory fsync/power-loss durability, symlink-safe containment, cross-store transactionality, real watcher E2E, live provider/keyring integration, structured web citation provenance, or full proposal crash recovery. Treat these as gaps, not failures, unless a targeted test/code path establishes otherwise.

`appStore.bootstrap()` loads bootstrap payload before attaching listeners; source shows no replay buffer for events emitted during that interval. Focus/visibility refresh provides mitigation but not a proved delivery guarantee.

## Maintenance workflow

The scheduled/manual documentation updater is [operations](operations/development-and-testing.md#openwiki-maintenance), sourced from `.github/workflows/openwiki-update.yml`. It depends on full Git history and unattended credentials/connector configuration, limits generated PR paths, and still needs review. Automation does not prove runtime behavior or resolve source ambiguity.
