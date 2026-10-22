# Search excerpt experiment, 2026-10-21

Decision: retain the current production preview implementation. This is a bounded,
offline presentation experiment, not a search or retrieval migration.

The existing preview already centers late matches and prefers the complete literal
query when present. Tantivy's term-weighted fragment selection is useful when
several terms occur together later without matching the complete literal query.
That advantage does not by itself justify changing the existing display contract.

## Reproduction and evidence

The throwaway exporter and interactive offline comparison live under
`.scratch/package-capabilities/evidence/search-excerpts/`. Run from the repository
root when native builds and performance measurements are idle:

```sh
python3 .scratch/package-capabilities/evidence/search-excerpts/export.py
```

Open the resulting `comparison.html` directly. `comparison.json` retains source
hashes, machine/runtime metadata, exact supplied text, the existing admitted
identities/order/scores, fragment byte ranges, scalar highlight ranges and raw
timing samples. `EXCERPT_SKIP_TIMING=1` skips measurement for correctness-only runs.
`timing-samples.json` separately preserves the original quiet timing capture;
`--reuse-timings` reuses a row only when its exact query/text hash and production
source hashes match, recording the timing capture's original metadata explicitly.
The prototype is ignored local evidence and has not been committed; the parent
implementation task explicitly requested no commits. No prototype route, command,
dependency, Rust module declaration or application behavior is added to production.

The exporter copies the actual Rust crate into its evidence directory and adds an
export-only module to that snapshot's lexical owner. Synthetic notes use the
actual `TestVault`, ordinary save/finalize seam, `NoteTimeline` canonical reads,
`LexicalIndex` fields/default tokenizer/query parser and current preview helper.
The in-memory index is the scratch vault's real projection, not a second product
index. Current-draft input is explicitly marked separately from saved canonical
content. The generated HTML has scenario controls and displays full fixture state;
all text/highlight rendering uses text nodes.

## Findings and limits

- `Snippet::fragment_range()` is useful: it identifies a UTF-8 byte range into
  the exact string passed to `snippet`. The prototype checks that slicing that
  string yields the fragment and converts fragment highlight bytes to Unicode
  scalar ranges. These coordinates remain internal experiment evidence.
- Use `snippet`, not `snippet_from_doc`, when source correspondence matters. The
  latter joins stored field values and trims the result. Neither API establishes
  a unique canonical paragraph, current navigation target, read receipt or citation.
- Installed Tantivy 0.27.0's `set_max_num_chars(180)` compares tokenizer UTF-8
  offsets in `search_fragments`, despite its character-oriented name/docs. It
  therefore gives non-ASCII text less context than our current 180-scalar preview.
  A production proposal needs an explicit, tested display-budget policy.
- Token highlights do not prove that a displayed fragment satisfies an entire
  phrase or Boolean query. The current parser continues to admit/rank candidates;
  a generator cannot replace that admission or alter its semantics.
- A new term in an admitted current draft can be absent from the index. Generator
  construction ignores absent indexed terms, so empty snippets require the
  existing literal/prefix fallback. No indexing wait or alternative authoritative
  index is warranted for presentation.
- Code-point correctness is not grapheme segmentation. Combining marks may be
  highlighted or cropped separately; a future grapheme policy is a separate choice.
  In the short Turkish/combining-mark fixture, Tantivy ends its fragment at the
  final token's `e`, dropping the following combining accent and emoji; the current
  preview retains them. Its token highlighting also differs from current literal
  lowercase-expansion/subsequence highlighting.

The corpus includes early/late matches, exact and distributed multi-term queries,
quoted/Boolean queries, unstemmed inflections and substring differences, Unicode,
duplicates, title-only input, no-literal semantic/tag illustrations, and a pending
draft. Semantic/tag illustrations do not assert new search admission: they show
fallback presentation only. Existing owner regressions remain the authority for
actual semantic fusion, metadata admission, policy, forgetting and frontend pane
selection behavior. Since production presentation stays unchanged, there is no
new navigation/selection path to verify interactively.

Timing is a warm, unoptimized Rust test-profile fragment microbenchmark with five
batches of 200 calls per saved fixture. Current-helper calls measure
`build_search_preview`; a no-match return does not include the prefix fallback's
allocation. Generator construction and fragment generation are measured separately.
It is not an end-to-end hybrid-search
benchmark, and it cannot establish a production latency budget. The decision to
retain the current behavior does not claim a measured end-to-end speedup.

## Execution record

The final corrected correctness-only export passed in 0.54 seconds after a
15.66-second copied-crate compile; its warmed measured export then passed in
1.97 seconds (Cargo overhead 0.22 seconds). Both used the isolated snapshot and
left production source untouched. The snapshot contained 678 test-harness cases;
the export invocation ran only its one export entry point, not that whole suite.
An evidence-fidelity check found that the initial pending-draft setup had used
the saved-note parser without the production draft seam's canonical-identity
adoption. The exporter was corrected to use `build_current_override` and adopt
the catalog identity/kind/tags exactly as interactive search does, with a strict
identity assertion. The title-only query was also made a single unique token so
parser splitting could not accidentally match ordinary body prose. These are
prototype corrections; they do not represent production defects. Both strict
assertions passed in the final corrected run. A fresh quiet timing capture then
replaced all initial timings, keeping the final JSON, HTML and timing manifest
consistent with the corrected source.

All 16 displayed fixtures completed. Every generated byte slice equaled its exact
fragment; all highlight byte boundaries converted to valid scalar ranges. The
experiment also exercised ten real owner observations: new/unindexed admission,
stale replacement suppressing removed text, caught-up projection without a
duplicate, current-path exclusion, catalog removal, restricted canonical scope,
excluded canonical scope, external-edit delivery rejection, changed managed
identity rejection, and repeated identity/order/score stability. These observations
do not expand the production contract or replace the existing regression suite.

The later distributed-term cluster improved from one visible query term to all
three (`common`, `rare`, `uncommon`). With the full literal query present later,
the current preview already shows all three. The 4,500-byte-late match remains
visible in both previews, whereas the separate 480-byte retrieval prefix misses
it. The Unicode tradeoffs fail this ticket's no-regression adoption gate:

| Fixture | Current displayed scalars | Tantivy displayed scalars | Observation |
| --- | ---: | ---: | --- |
| Mixed Unicode around `Needle` | 182, including ellipses | 16 | Large loss of surrounding context |
| CJK around `中文` | 181, including ellipses | 89 | Byte budget halves available context |
| Turkish dotted I, combining accent, emoji | 21 | 16 | Trailing accent/emoji omitted; literal/token highlights differ |

Selected timing medians in microseconds per call follow. Each entry retains five
raw batches in the JSON, not just these summaries. These matching fixtures use the
current helper's complete matching path; no no-match/fallback timing is compared.

| Fixture | Current helper | Tantivy generation | Tantivy generator construction |
| --- | ---: | ---: | ---: |
| Beginning | 53.82 | 25.87 | 6.69 |
| Late | 404.79 | 198.58 | 6.63 |
| Distributed terms | 58.92 | 28.94 | 12.74 |
| CJK | 54.04 | 61.19 | 4.87 |

Machine: macOS 26.6.2, arm64; Rust 1.95.0; Tantivy 0.27.0. The sandbox denied
the CPU-brand `sysctl`, recorded explicitly in the manifest rather than guessed.
These values describe this quiet warm test-profile run, not release performance.
No end-to-end timing claim or production integration is justified by them.

The self-contained HTML was inspected in a disposable WDIO 10 Chrome session:
distributed-term controls show one current highlight versus three Tantivy
highlights; Unicode highlights preserve `Needle`; pending-draft empty snippets
show the existing fallback and correct highlighted draft term. Wide and narrow
screenshots were visually inspected (1440px and Chrome's actual 500px minimum
window width), with no horizontal overflow. The trace and screenshots are under
`e2e/agent/.wdio/session/search-excerpt-prototype/`; the owned session was closed.
No persistent fixture server was needed for this local file, and no throwaway
prototype regression was promoted to the production test suite.

The remaining admission/navigation acceptance cases remain unchanged and belong
to their existing owners: semantic fusion, metadata-only search, forgetting,
pagination/deduplication, and unsaved split-pane selection. They are not new
snippet-enabled flows. There is no adoption follow-up because the Unicode gate
failed and the current algorithm already solves the ordinary late-match case.

## Primary sources

- Installed `tantivy-0.27.0/src/snippet/mod.rs`: `Snippet::fragment_range`,
  `SnippetGenerator::create`, `snippet`, `snippet_from_doc`, `search_fragments`.
  [Published source](https://docs.rs/crate/tantivy/0.27.0/source/src/snippet/mod.rs).
- Repository `src-tauri/src/search.rs` (`build_search_preview`), `lexical.rs`
  (`search_with_catalog`, `search_locked`, `lexical_preview`) and
  `services/note_timeline/current_content.rs` (`read_note`, `validate_note_read`).
- [Capability implementation issue](../../.scratch/archive/package-capabilities-2026-10-21/tickets/06-query-centered-excerpts.md).
