# Atlas relevance — 2026-10-22

## Outcome

Atlas continues filtering existing map nodes in place. Native admission now requires lexical/structural relevance or the embedding provider's calibrated text threshold; recency and frequency only rank admitted matches. Gemma's background similarity can no longer count all notes as found. Tag intersection, exact-query guards and existing map geography remain intact.

## Try it

In Atlas, search for a distinctive term shared by only a few notes, then a nonsense term, then clear the input. Matches should narrow, nonsense should show zero matches, and clearing should restore all nodes without moving them. Search remains a map filter.

## Validation

- Focused frontend checks covered Atlas filtering; Svelte and E2E TypeScript
  checks reported zero errors/warnings.
- Native Rust coverage passed for provider-calibrated Atlas admission and a full
  seeded index query.
- Browser replay covered desktop/compact layout, stale-query handling, clearing
  and unchanged node positions.
- The real EmbeddingGemma runtime indexed three synthetic notes: `rainwater`
  returned one match and `zxqvnoidea` returned zero. Initial runs exposed a fixture
  setup omission: deliberately absent startup assets exhausted bounded indexer
  retries; invoking the ordinary Retry command after asset installation settled
  the index and passed. No foreground/focus override was used.
- `pnpm build` passed with the existing Vite large-chunk advisory.

Native acceptance uses a pinned artifact from this exact worktree and disposable vaults: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256 `7f84100159dadddeeb21df43de62801688478f36395076bd643d9f78cb4a569d`. Browser fixtures verify presentation/controller behavior; they do not establish native model behavior. The real-model lane is explicitly opt-in and requires pinned local semantic assets. Physical-device behavior is not established by these macOS checks.
