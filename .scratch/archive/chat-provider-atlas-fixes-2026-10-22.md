# Chat provider failure and Atlas filtering, 2026-10-22

## Outcome

Atlas now filters map nodes in place. The editor-style ranked note picker was rejected by the user and removed. The map retains accepted geometry, camera behavior, ordinary node opening and its existing keyboard navigation. Nonmatching nodes, their filename labels and their connections are excluded from rendering. Clearing restores the admitted inventory. Current-query/source-identity checks and search thresholds still admit matches; stale responses cannot filter a newer query. Loading, empty counts and Retry remain on the map. Ordinary editor retrieval cues and passage navigation remain unchanged.

The local model failure was reproduced independently of the app and through the worktree's real native/Pi path. The configured model server rejects loading the selected `qwen3.8-27b-gsq-rco` model with HTTP 400. Initial bounded synthetic probes classified a memory-related load failure; later native attempts reported the broader model-load failure. This is an external server/model loading condition.

The native transport now returns fixed model-loading / model-memory recovery categories. The frontend preserves allowlisted native categories through Pi's status-prefixed HTTP error parser. Chat reports a useful load/recovery instruction instead of the generic "Start a new attempt" error. Unknown provider content remains redacted. Credential, quota, rate-limit and transient HTTP recovery retain precedence.

## Scope and owners

- `src/lib/features/atlas/AtlasSearch.svelte`: filter bar without suggestion UI.
- `atlasStore.svelte.ts::matchingNodeIds`: current-query admitted node identities, independent of display ranking.
- `AtlasMap.svelte`: presentation filtering without layout/persistence changes.
- `src-tauri/src/pi_chat/transport.rs::provider_http_failure`: bounded native failure classification.
- `src/lib/features/chat/pi/nativeProvider.ts::safeFailure`: allowlisted structured/parsed Pi errors only.
- `e2e/specs/native/piConnectionErrors.spec.ts`: real native HTTP/Pi/UI error recovery contracts.

## Verification

- Focused Vitest checks passed for Atlas store/layout and native provider parsing.
- 11 native transport unit checks passed, including diagnostic privacy and HTTP recovery precedence.
- Native regression checks used an isolated HTTP fixture, disposable vault and pinned worktree E2E binary to cover chat load/memory failures and ordinary canonical saving; connection/cancellation checks were retained.
- Live native diagnosis reproduced the model-load rejection through ordinary chat using synthetic content in a disposable vault. It establishes failure, not live generation success. The temporary probe was removed after recording the result.
- WDIO session `atlas-filter-fix`: trace, screenshot inspected, exported regression cleaned and fresh replay 3/3 passed (desktop filtering/coordinates/clear/open; compact controls; stale/loading/error/Retry). Initial recovery expectation used "Alpha", also present in Beta's fixture text; corrected to the unique fixture word "regression". The failed expectation was a test assumption, not a filtering defect.
- `pnpm check`: zero Svelte errors/warnings; E2E TypeScript checks passed.
- Production build passed; existing large-chunk warning remains.

## Runtime evidence and limits

The worktree process executable and cwd were verified under `/Users/bray.polkinghorne/.codex/worktrees/93d8/Gneauxghts/src-tauri/target/debug/gneauxghts`. The first CUA app-name inspection selected the installed app and was discarded as worktree evidence. Subsequent native checks use the exact pinned worktree artifact. Ordinary dev and installed apps share the default device/vault settings; fixture runs isolate both. No user vault content or credentials were sent by the diagnostic probes; no raw provider errors were retained.

The configured live model still fails to load. Successful generation with that model cannot be claimed until its server can load it. The app does not switch models, unload other sessions, or modify server memory/context settings automatically.

## Manual retest

1. Run `pnpm tauri dev` from the 93d8 worktree (or keep its existing dev process running).
2. Load the selected local model successfully in its server; free model memory, reduce the server's context allocation, or choose a model the server can load.
3. In chat, start a new attempt with a short message. A remaining model-load failure now gives an actionable explanation.
4. On Map, type a unique phrase or tag. Matching nodes remain in their existing positions and no note-picker panel appears. Clear to restore all nodes. Open a visible node as usual.
