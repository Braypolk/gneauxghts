# Atlas relevance tightening — 2026-10-23

## Outcome

The reported `blue bell` query admitted `deploy` through semantic similarity,
despite neither word appearing in that note. A CPU query embedding from the
installed pinned Gemma model, compared with a read-only snapshot of the saved
index, put 64 of 174 notes above the existing 0.70 candidate floor. `deploy`
scored approximately 0.7124; the five Blue Bell notes scored 0.7065–0.7496.
The previous floor could not distinguish those named notes from weak matches.

Native Atlas filtering now requires complete query-word coverage across its
existing searchable fields or stronger semantic evidence. Word boundaries
prevent `rain` matching `Brainstorming`; the final query word supports prefix
completion from three characters. Partial query coverage and structural boosts
cannot independently admit a note. Tag intersection remains unchanged.

Semantic admission uses the provider's candidate floor plus the greater of 20%
of its remaining similarity headroom or 80% of the best candidate's headroom
above that floor. With Gemma this requires at least 0.76 and can tighten further
when a closer semantic match exists. Direct text matches survive regardless of
semantic score. Recency/frequency affect ordering only. This deliberately trades
weak semantic recall for a more selective map filter; ordinary note retrieval
retains its existing policy.

## Validation

- A seeded real-index regression failed before the fix: `rain` admitted both
  `Brainstorming` and weakly similar `Invoices`. It passes after the correction,
  alongside full multiword coverage, the reported title/query pattern, semantic
  matches, nonsense queries, and combined tag/text filtering.
- Replayed the production Rust Atlas query against a temporary copy of the
  saved index using the real CPU-generated `blue bell` embedding. It returned
  exactly the five Blue Bell notes and excluded `deploy`. The original vault
  and index were read only. The snapshot excludes any uncheckpointed WAL edits.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib atlas --offline`:
  95 passed.
- Atlas store Vitest suite: 18 passed.
- `pnpm check`: no Svelte errors/warnings; E2E TypeScript passed.
- Temporary local diagnostic tests, query vectors, index copies and runtime
  caches were removed. Retained regressions use synthetic index rows, with
  representative scalar similarities from the reported case.

The model probe used CPU inference, not the live app's GPU engine. This verifies
native retrieval admission and retained frontend filtering contracts; no new
interactive UI, packaged-app or physical-device verification was performed.
