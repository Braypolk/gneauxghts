---
type: operations guide
title: Development, testing, builds, and releases
description: Local setup, validation layers, semantic runtime packaging, desktop build/release behavior, and OpenWiki maintenance automation.
tags: [development, testing, release, operations]
---
# Development, testing, builds, and releases

## Setup and entrypoints

Prerequisites are Node.js, pnpm, Rust toolchain, and platform Tauri dependencies. `package.json` defines `pnpm dev` (Vite), `pnpm tauri dev` (wrapper around CLI), `pnpm build`, `pnpm check`, `pnpm test`, and E2E scripts. `vite.config.js` serves Tauri at strict port 1420, ignores `src-tauri` watcher changes, runs Vitest only for `src/**/*.test.ts`, and redirects CodeMirror language data to a curated vendor subset.

```bash
pnpm install
pnpm tauri dev
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Use source-focused commands before broad gates: `pnpm test -- src/lib/features/notepad/document`, `pnpm test -- src/lib/features/chat`, or `cargo test --manifest-path src-tauri/Cargo.toml semantic` where applicable. `src-tauri/tests/architecture_fitness.rs` guards selected architectural ownership such as a single semantic queue/worker context.

## E2E layers and debugging

`pnpm test:e2e:browser` starts Vite on 1421, installs `VITE_E2E_BROWSER=true` in-browser deterministic Tauri IPC, and drives the real Svelte app in Chrome. Its current spec proves repeated note A/B isolation and note→chat→note scroll restoration. It does not establish real filesystem watcher, proposal, external conflict, or provider behavior despite broader guidance in `e2e/README.md`.

`pnpm test:e2e:native` builds Cargo with `e2e-wdio`, starts Vite at 1420, launches a real macOS Tauri window with temp app/documents/vault/keyring namespace, and runs smoke checks for startup/window geometry/debug automation. The automation plugins are feature-gated out of normal/release builds. Use native cases for window state, OS events, persistence, or plugin boundaries.

Settings exposes semantic state/diagnostics; Rust commands include semantic debug metrics, retry/rebuild/pause/resume, model preparation/download, and `report_user_activity`. Browser console logging and Tauri/Rust stderr are the immediate debugging surfaces.

## Semantic runtime supply chain

`semantic/embed.rs` resolves a local `llama-server`: packaged builds prefer the bundled resource, development can use `GNEAUXGHTS_LLAMA_SERVER_BIN`, then PATH/Homebrew/common locations. The model is local Jina GGUF; local-only settings prevent download and return placement guidance.

`src-tauri/build.rs` is release-critical: it discovers/stages `llama-server` and dependent libraries into resources, handles platform relinking, and performs platform signing-related work. `src-tauri/tauri.bundle.conf.json` packages `resources/bin` as `bin` and `resources/lib` as `lib`; `lib.rs` resolves packaged `bin/llama-server` outside debug. A frontend semantic feature can be correct while packaged embeddings fail because resource staging, dylib linking/signature, architecture, or model availability is wrong. Validate a packaged build on target OS; unit tests cannot prove this boundary.

## Build and release

`tauri.conf.json` runs `pnpm dev` before dev and `pnpm build` before build, with `../build` frontend distribution. `scripts/tauri.mjs` injects `src-tauri/tauri.bundle.conf.json` for non-debug builds. `pnpm release:mac` sets notarization enforcement; on macOS it requires signing identity or certificate plus one notarization credential set, then verifies app and DMG with `codesign` and `spctl`. Do not expose release credentials in docs/logs; configure them through CI secret mechanisms.

## OpenWiki maintenance

`.github/workflows/openwiki-update.yml` runs manually (`workflow_dispatch`) and daily at `0 8 * * *`. It requires `fetch-depth: 0`: `openwiki code --update` needs full history to find its prior documented commit. It installs fixed OpenWiki/Mermaid/jsdom versions and invokes update mode.

The job sets an OpenWiki provider/model and injects LangSmith connector/tracing secrets. The workflow comment states browser-login OpenAI authentication has no unattended equivalent, so CI credentials must be supplied; automated runs may fail or have connector coverage limits without them. It creates a PR limited to `openwiki`, `AGENTS.md`, `CLAUDE.md`, and its workflow. Treat the PR as generated code requiring source/claim/link/diagram review, not an authoritative change. See [documentation drift](../documentation-drift.md) for what this wiki currently flags.

## Validation matrix

| Change | Narrow check | Add broader validation when |
| --- | --- | --- |
| Svelte state/UI | focused Vitest + `pnpm check` | route/pane integration changes |
| Rust persistence/search/chat | focused Cargo module tests | command, schema, or service wiring changes |
| IPC payload | `ipcFixtures.test.ts` plus consumer test | handlers/events change |
| Browser composition | `pnpm test:e2e:browser` | editor/pane lifecycle regression risk |
| Native/window/plugin/filesystem | `pnpm test:e2e:native` | OS/Tauri integration changed |
| Release/runtime packaging | `pnpm tauri build` target smoke | `build.rs`, bundle config, embedding runtime changed |
