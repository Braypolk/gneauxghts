# Evaluate query-aware excerpts against the existing search previews

Archived execution ticket, 2026-10-21. The original plan and chronological comments below are historical, outside the executable backlog. See the [implementation outcome and verification limits](../../package-capabilities-2026-10-21.md#integration-result).


Historical record: implementation complete; combined acceptance is tracked in the outcome record.
Type: prototype
Scope: bounded comparison and adoption decision; production integration remains gated
Depends on: none

## Problem and correction to the original opportunity

The useful question is whether token-aware fragment selection makes an existing search result easier to recognize. Ordinary all-notes Search already centers a roughly 180-character preview around a literal query/term through `search.rs::build_search_preview`. Current-note Search also crops around its occurrence. Pi's `notes.rs::search_notes` discovers candidates in the catalog, then rereads canonical saved bytes and builds its preview through `search_note`. Do not implement a second query-centering feature on the assumption those previews are prefixes.

The prefix-only gap is in `services/retrieval/search.rs`: canonical candidate passages are bounded to 2,400 bytes and delivered excerpts to 480 bytes. However, its `retrieve_note_context` query adapter is not the ordinary Search or Pi search path, and the frontend `retrieveNoteContext` wrapper currently has no production caller. Its native verification test is not evidence of a product consumer. Improving that unused presentation alone would not establish a user benefit.

Tantivy 0.27's newly available `Snippet::fragment_range()` makes it possible to retain the source location of a selected fragment. Run a small comparison against **the current previews**, including multi-term queries where a best fragment may be more useful than the earliest literal match. A decision to retain the current implementation is a valid completed outcome.

## Current ownership and authoritative contracts

- `src-tauri/src/search.rs` owns catalog matching, literal query-centered cropping, case-expansion correspondence, and code-point highlight ranges.
- `src-tauri/src/lexical.rs` owns the in-memory Tantivy fields/tokenizer/query parsing, scope-before-collector behavior, and the mutually exclusive indexed/catalog fallback for pending projections. Its `search_locked` currently uses `build_search_preview`; `passage_matches_with_catalog` supplies candidates to the separate retrieval owner.
- `src-tauri/src/commands/search_commands.rs` owns interactive hybrid admission, current unsaved draft overrides, tag filtering, cache generations, access weighting and merging. The user-facing command is `search_notes_hybrid`.
- `src-tauri/src/services/retrieval/search.rs` owns the separate bounded canonical retrieval. Its `CanonicalSnapshot`, `current_text_range`, fingerprint checks, passage identities and overlap/ranking logic are not frontend navigation contracts.
- `src-tauri/src/pi_chat/notes.rs::search_notes` owns Pi search admission and pagination; `NoteTimeline` owns canonical reads and final current-content delivery. Search never issues a `ReadSource` or citation receipt.
- `src/lib/features/notepad/search/currentNoteSearch.ts` owns current-note occurrences. `src/lib/features/notepad/navigation/openFlow.ts::openSearchResult` opens by existing identity/path and uses existing `sectionLabel`/`matchText` navigation. It does not consume Tantivy byte positions or a new passage-location field.
- `src/lib/features/notepad/ui/NotepadCommandBar.svelte`, `src/lib/ui/search/SearchNoteResult.svelte` and `src/lib/types/semantic.ts` own current result presentation/contracts. Rendering uses code-point highlight coordinates; CodeMirror positions use UTF-16.

Read [ARCHITECTURE.md](../../../../ARCHITECTURE.md), the [navigation/search and current-content invariants](../../../../docs/architecture/behavior-invariants.md), and [ADR 0012](../../../../docs/adr/0012-found-ordinary-chat-on-pi.md). [ADR 0003](../../../../docs/adr/0003-limit-chat-history-access-to-current-content.md) is partly superseded and cannot establish a prohibition on Pi retaining earlier read context. Current claims still require an authorized read; previews are not read proof.

## Experiment to implement

1. Capture a small, synthetic, inspectable fixture corpus and the existing result order/identities/scores plus rendered previews. Use the actual helpers and scratch `TestVault` canonical reads, not hand-authored facsimiles. Include the corpus/query table below. Do not use private vault content or mutate the user's Running Vault.
2. Compare three presentation algorithms on the **same admitted candidate and exact supplied text**: current `build_search_preview`; Tantivy `SnippetGenerator::snippet(&canonical_paragraph)` plus `fragment_range`; and current literal centering applied after any applicable canonical correspondence, as a fallback. Preserve the current result and UI display budgets for an honest comparison; separately record the retrieval adapter's 480-byte cap without installing a new product surface for it.
3. Keep the experiment beside the search module, visibly named as a prototype, and provide a one-command fixture export plus an inspectable side-by-side artifact. An offline HTML comparison is sufficient; show query, Note Identity, candidate text provenance, exact chosen range, excerpt and highlights for each alternative. Do not add a production route or public command. Follow the prototype skill when performing this future experiment, including capture of the throwaway prototype away from main and a context pointer here.
4. Test the Tantivy generator against the actual field tokenizer/query semantics, rather than adding an independent query dialect. `SnippetGenerator::create` weights query terms by indexed document frequency and ignores absent terms: a catalog-only/pending note can therefore receive an empty snippet. This must fall back cleanly and must never make pending notes unsearchable. Do not construct a second authoritative index, block until indexing finishes, or change scores to make the snippet generator convenient.
5. Record the result in this ticket: fixture outputs, comparison command/runtime/package versions, measured fragment-generation overhead, cases improved or worsened, and **adopt / retain current implementation**. This ticket authorizes the experiment and decision; it does not authorize an unbounded retrieval rewrite.

### Coordinate and content rules

- Generate the candidate excerpt from text admitted by its real owner: verified canonical saved text for saved-note experiments, and the admitted current draft for the existing interactive unsaved-note case. Indexed normalized paragraph text discovers/ranks candidates; it is not proof of current content.
- `fragment_range()` is a UTF-8 byte range into the string passed to `snippet`. Use `snippet`, not `snippet_from_doc`, because the latter joins field values and trims them. Assert that slicing that exact string by the returned range equals the fragment, and reject out-of-bounds/non-boundary coordinates.
- Apply any whole-note offset only after mapping the exact canonical paragraph into canonical body/title coordinates. Keep byte offsets internal. Do not add these coordinates to `SearchItem`, `VaultRetrievalItem` or Pi's `SearchItem` merely because they are available.
- Convert fragment-relative highlight byte ranges to Unicode scalar/code-point ranges for existing rendering. If a future navigation implementation needs editor positions, convert canonical UTF-8 positions explicitly to UTF-16 against the **current** editor text. Ellipsis/trimming offsets and Unicode lowercase expansion must be accounted for separately. Do not normalize canonical text and assume offsets survived.
- A repeated paragraph or ambiguous normalized correspondence must retain the current safe behavior; never select the first occurrence and call it verified. A preview offset cannot become a citation, read receipt, stale navigation target or substitute for the existing exact-match navigation policy.

## Acceptance and decision gate

The experiment is complete when its artifact makes the following comparisons reproducible and the ticket records a concrete decision:

| Fixture/query | Required observation |
| --- | --- |
| Match near the beginning, and a single match after thousands of characters | Existing ordinary Search already shows the late literal match; proposed excerpts keep it visible. Measure the distinct prefix-only retrieval case separately. |
| Multi-term paragraph with an early common term and later useful co-occurring terms | Demonstrate whether fragment scoring conveys more query context within the same display budget; do not imply phrase semantics or change result membership. |
| Quoted phrase, Boolean query, and differently inflected words | Compare the existing helper with actual installed parser/tokenizer behavior, including fragments that highlight individual terms without proving a whole phrase. Record no-match/fallback behavior for word forms the current analyzer does not equate; do not introduce stemming or broaden query semantics to make the experiment pass. |
| Emoji, astral characters, CJK, combining marks, Turkish uppercase dotted I and surrounding whitespace | Valid UTF-8 slicing and exact code-point highlights; no byte/code-point/UTF-16 mixing, broken glyph encoding, or changed canonical text. Record combining-mark/grapheme presentation limits explicitly. |
| Repeated or whitespace-normalized duplicate paragraphs | No fabricated unique canonical location, citation or editor target; ambiguity remains safe. |
| New note before lexical indexing, stale projection after an edit, then caught-up projection | Current fallback still yields the eligible note, never duplicates indexed/fallback results, and does not resurrect removed text. Absent index terms trigger a safe excerpt fallback. |
| Semantic-only hit without literal terms; title-only and metadata/tag-only hits | Retain meaningful existing previews and no invented keyword highlights; preserve title-only remembered cursor behavior and existing semantic focus behavior. |
| Excluded/forgotten note, narrowed scope, external edit during delivery and changed managed identity | Existing current-content gates/fingerprint or refresh protocol reject or retry as before. No preview crosses policy boundaries. |
| Equal scores, multiple passages from one note, index rebuild and repeated calls | Identical admitted Note Identity set, order, deduplication, scores and pagination to baseline; new excerpt fragments never become ranking or deduplication keys. |
| Unsaved current draft and split-pane selection | Preserve the admitted draft preview and current-note occurrence behavior; current pane selection/focus/scroll remains owned by the existing navigation path. |

Adopt only if the comparison shows a clear improvement for the multi-term cases that **the current helper does not already solve**, no regression for the single/late-match and Unicode fixtures, and no material end-to-end query delay beyond repeated baseline variability. Record raw timings and the machine; do not turn one machine's values into an architectural budget. If quality is equivalent, or safe integration needs new search/ranking/navigation semantics, retain the existing algorithm and close this experiment with that conclusion. Do not create speculative production code to justify using the new API.

If adoption is justified, split out a fully specified follow-up issue naming the actual product consumer, immutable presentation input/output, required canonical admission seam, and final coordinate convention. Initially change only excerpt/highlight presentation after candidate selection; audit `merge_hybrid_candidates`/deduplication and any consumers that currently inspect excerpt text so unchanged ranking is demonstrated rather than assumed. Preserve existing `matchText`/section navigation, score/order, body/title identities, limits, date/tag scope, exclusions, cache generation, pending-index fallback and Pi authority/cursor semantics. Any broader query, sort or navigation feature requires its own decision. No production adoption is implied by this issue's ready status.

## Future validation owners

Use focused Rust cases beside `search.rs`, `lexical.rs`, `services/retrieval/search/tests.rs`, `commands/search_commands/helper_tests.rs` and Pi note-search tests as applicable. Frontend coordinate/render verification belongs beside `currentNoteSearch.test.ts`, the shared highlight segment tests and `navigation/openFlow.test.ts`; do not rewrite current-note search for an all-notes preview experiment. If a production UI follow-up is accepted, replay the late/multi-term/Unicode cases in browser and native Search through `docs/agents/ui-verification.md`, retaining screenshots and deterministic replay. No full native benchmark suite is required for the planning or offline experiment alone.

This work can run in parallel with connection classification, benchmark tooling, component inspection, client error presentation and the image-delivery experiment. Reserve `search.rs`, `lexical.rs`, retrieval/search and any accepted follow-up search test files to one implementer. It does not depend on any of those other tickets and must not modify the existing CodeMirror/Lezer upgrades or patches.

## Source evidence

- [Capability investigation](../../../../docs/research/upgraded-package-capabilities-2026-10-21.md#3-search-excerpts-useful-product-experiment-medium-effort).
- [Tantivy 0.27 changelog](https://github.com/quickwit-oss/tantivy/blob/0.27.0/CHANGELOG.md).
- [Published 0.27 snippet source](https://docs.rs/crate/tantivy/0.27.0/source/src/snippet/mod.rs): `fragment_range`, `snippet`, `snippet_from_doc`, generator term weighting and absent-term behavior. The web mirror did not serve the versioned API pages during planning; the installed `tantivy-0.27.0/src/snippet/mod.rs` was inspected directly to verify those claims.

## Comments

- 2026-10-21: Planning only. No prototype, application change, new benchmark or runtime verification has been performed by this ticket.
- 2026-10-21 execution: Completed the bounded offline experiment; **retain the current production preview**. The ignored throwaway source, JSON and self-contained interactive HTML are at `.scratch/package-capabilities/evidence/search-excerpts/`; reproduce with `python3 .scratch/package-capabilities/evidence/search-excerpts/export.py`. Correctness export and warmed measured export pass (16 fixtures plus ten real owner admission/current-content observations). See [the durable report](../../../../docs/research/search-excerpt-experiment-2026-10-21.md) for raw-evidence locations, measured costs, caveats and the decision. Distributed multi-term context improves, but current previews already center late/full-literal matches. Tantivy 0.27's budget compares UTF-8 bytes: CJK context shrinks from 181 displayed scalars to 89, mixed Unicode from 182 to 16, and a short combining-mark fixture drops its trailing accent/emoji. This fails the no-regression adoption gate. No production source, search contract, ranking, navigation, read authority or dependency was changed. Prototype-only branch capture was waived by the parent instruction to make no commits; evidence remains isolated/ignored. Interactive artifact inspection awaits the shared measurement window; production UI verification is unnecessary for this retain-current decision.
- 2026-10-21 fidelity check: Corrected only the throwaway pending-draft fixture to use `build_current_override` plus the real canonical-identity adoption policy, adding a strict Note Identity assertion; tightened the title-only query to one unique token. Final corrected correctness export is pending the quiet measurement window. Previously captured timings are retained only against matching exact query/text and production source hashes; no corrected presentation input inherits an incompatible timing.
- 2026-10-21 final verification: Corrected export passed with strict canonical-draft identity and title-only highlight assertions (0.54s after 15.66s snapshot compile); a fresh quiet measured export passed (1.97s), replacing earlier timing samples. All 16 fixtures and ten owner observations pass. WDIO 10 verified distributed-term/Unicode/pending-fallback interactions; inspected 1440px and actual 500px screenshots, checked no horizontal overflow, retained session trace and closed the owned browser. No production change or adoption follow-up is needed. Experiment complete; ready for parent tracker archival.
