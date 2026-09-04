# 34: Prove the native Phase 1–3 integration journey

**What to build:** The shipped Rust, Tauri, and Svelte implementations prove together that the complete Phase 1–3 Note Timeline journey works without relying on the browser-only history model.

**Blocked by:** 27: Repair revision continuity after history reset; 28: Page Missing Note recovery timelines; 29: Restore exact editor state after History Mode; 30: Encapsulate Note Timeline runtime coordination; 31: Centralize current-content access; 32: Stabilize the timeline command contract; 33: Make Phase 1–3 timeline internals navigable.

**Status:** ready-for-agent

- [x] Drive real native note edits through revision capture, paged History Mode navigation, deterministic diff, complete Version Restore, and return to the exact live editor state.
- [x] Exercise external deletion, Missing Note discovery, incremental history loading, safe recovery, and continued editing through the native command path.
- [x] Exercise unavailable or corrupt history reset followed by forgotten-note recovery and prove the recovered timeline remains selectable, diffable, and restorable after restart.
- [x] Run shared Rust and TypeScript contract fixtures as part of the native integration gate.
- [x] Keep temporary-vault, fault-injection, architecture, component, browser, and native suites green and record commands suitable for repeating the Phase 1–3 gate before Phase 4 changes.

## Comments

The native Phase 1–3 spec owns three integration journeys: live editor capture/paging/diff/restore/state return; external deletion/Missing Note paging/collision-safe recovery/continued editing; and corrupt reset/forgotten recovery/restart/diff/restore. `pnpm test:e2e:native` now runs the shared TypeScript and Rust timeline-contract fixture checks before building and driving the feature-gated native app. The repeatable full gate is recorded in `e2e/README.md`.
