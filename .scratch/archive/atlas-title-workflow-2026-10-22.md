# Atlas relevance and previewed titles — 2026-10-22

Automatic AI titles were subsequently [retired at the user’s request](retire-ai-titles-2026-10-22.md). The title sections below describe the historical experiment; Atlas relevance remains current.

## Outcome

Atlas continues filtering existing map nodes in place. Native admission now requires lexical/structural relevance or the embedding provider's calibrated text threshold; recency and frequency only rank admitted matches. Gemma's background similarity can no longer count all notes as found. Tag intersection, exact-query guards and existing map geography remain intact.

Ordinary new captures keep a blank visible title across saves and reopening. The canonical file initially uses `Untitled Note <Note Identity>.md` with managed `untitled` metadata. The marker and exact temporary filename must agree: an explicit filesystem/Pi rename immediately supplies a normal title without rewriting the note. Existing named notes retain their titles.

Automatic titles remain opt-in under Settings → AI & Chat. After a saved untitled body reaches 80 Unicode characters, inference first tries the configured default model. The suggestion appears with Accept/Reject, then applies through ordinary editor persistence after ten seconds without edits. Typing a title always wins, including typing and clearing it. Reject/typed-title intent is remembered by note identity across reopening. Body changes withdraw stale suggestions; conflicts, publication, history and title editing block application.

If the default model fails, times out or produces an invalid title, the same saved-note lease asks the existing semantic runtime to rank bounded phrases extracted from the note. EmbeddingGemma selects authored text; it does not generate new text. This fallback needs semantic search enabled and available model assets, but no completed corpus index. Both result paths revalidate permission, exact source and lease membership. Neither inference path can write or rename files.

The default request has a 30-second generation deadline. For local models, optional reasoning is disabled only when the server advertises that option, preserving the title output budget without changing Chat preferences.

## Try it

Run `pnpm tauri dev` from this worktree and enable automatic titles in Settings → AI & Chat. Create a new note and leave the title untouched. A short body keeps the title blank. Write at least 80 characters and pause for autosave/inference: the suggestion should appear below the title field. Accept applies immediately, Reject leaves it blank and suppresses later suggestions for that note, and doing nothing applies it after ten seconds. Editing the body cancels an old suggestion. A title you type is never replaced.

To exercise fallback, make the default model unavailable while semantic search and its downloaded model remain available, then create another untitled note with two or more descriptive sentences. Its suggestion should be a phrase from that note. Restore the connection afterward. Existing titled notes are not retitled.

In Atlas, search for a distinctive term shared by only a few notes, then a nonsense term, then clear the input. Matches should narrow, nonsense should show zero matches, and clearing should restore all nodes without moving them. Search remains a map filter.

## Validation

- 114 focused frontend tests pass across Atlas, native provider, Pi title jobs, title controller, persistence and browser backend; Svelte and E2E TypeScript checks report zero errors/warnings.
- Native Rust coverage passes for provider-calibrated Atlas admission, a full seeded index query, phrase extraction/ranking, title lease/rejection/source proof, ordinary save/read/rename behavior, and local reasoning transport.
- Six browser replay cases pass across title suggestions and Atlas filtering, including desktop/compact layout, idle/explicit acceptance, rejection, stale-query handling, clearing and unchanged node positions. The initial live UI run found a header overlay intercepting suggestion controls; the controls now live inside the measured top overlay and pass replay.
- Real native default-model inference passed with loaded `qwen/qwen3.8-27b` on synthetic note content. A refused default-provider connection then produced a real EmbeddingGemma extract: “Install a timed drip irrigation system for the tomatoes while we travel”. No user notes were sent, and no user vault/settings were changed.
- The same real EmbeddingGemma runtime indexed three synthetic notes: `rainwater` returned one match and `zxqvnoidea` returned zero. Inference alone left the blank title and saved body unchanged. Initial runs exposed a fixture setup omission: deliberately absent startup assets exhausted bounded indexer retries; invoking the ordinary Retry command after asset installation settled the index and passed. No foreground/focus override was used.
- Five native provider/UI regressions pass on the same artifact, including actual editor capture → blank-title preview → automatic title → canonical save, model-load recovery, curated connection errors and Stop followed by successful generation.
- `pnpm build` passes. Vite reports its existing large-chunk advisory; it is not a build failure.

Native acceptance uses a pinned artifact from this exact worktree and disposable vaults: `src-tauri/target/e2e/debug/gneauxghts`, SHA-256 `7f84100159dadddeeb21df43de62801688478f36395076bd643d9f78cb4a569d`. Browser fixtures verify presentation/controller behavior; they do not establish native model behavior. The real-model lane is explicitly opt-in and requires pinned local semantic assets. Physical-device behavior is not established by these macOS checks.
