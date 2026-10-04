# Dense Rust history test contract audit

Status: complete
Progress: Read-only contract classification and proposed fixture integration recorded. No tests, builds, measurements, or source edits. Coordinator owns timing and implementation approval.

## Decision

Three test functions are reasonable candidates for a **test-only completed-history fixture**: the two dense inventory functions and the 80-revision citation-context function below. Their seed loops establish data; their subsequent assertions exercise production read/authorization/cursor/budget behavior. Keep those assertions and subsequent mutations unchanged.

Do **not** replace the 140-revision adaptive-checkpoint loop or the 16 identical / eight abandoned publication loops. Those tests measure behavior caused by the writer sequence itself. A prebuilt representation cannot substitute for it, even if all current read assertions pass.

This recommendation makes no speed claim. Current source was inspected directly; the prior foreground-guard experiment has been reverted in these loops. It is not a prerequisite of this proposal.

## Reader candidates and exact preservation contract

### R1: inventory pagination across row and byte budgets

`src-tauri/src/services/note_timeline/editing_window_capture/tests/query_inventory.rs:105` — `query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass`.

Replace only `Fixture::new()` / 55-note seed construction with a completed-history seed in a fresh test vault, or retain the existing fixture and seed before creating any read capability. Keep two separate sparse/dense iterations and **55 allowed notes in each**. Keep each note's distinct title `Inventory {i}`, distinct prefix `Unique inventory content {i}.`, and dense suffix `"Long but current note content. ".repeat(400)`. The existing base `Window` note is outside `allowed`; either retain it or include an equivalent excluded real note, so the allowed-set assertion is not satisfied merely because the vault contains nothing else. Do not reduce the byte workload based solely on the 50-row threshold.

Unchanged production operations/assertions:

- Request range `2020-01-01` through `2030-01-02`; normal request normalization and `EvidenceSession.inventory`.
- Every page nonempty; original search retained exactly once across continuation.
- First stop reason `display_rows` for sparse versus `inventory_page_bytes` for dense.
- Actual serialized rows ≤256,000 bytes and ≤reported charged inventory bytes.
- Scope/currentness checks on every page; every row in `allowed`; no duplicate IDs; complete union equals all 55 IDs; multiple pages and fewer than ten.
- Reusing a continuation with a changed exclusion fails.
- A **real** `clear_note_history` mutation after paging invalidates the saved cursor despite unchanged canonical note bytes. This remains runtime work, not a prebuilt post-clear result.

Required fixture semantics: real managed identities/canonical Markdown, valid retained non-baseline activity within the requested interval, current identity/path catalog bindings, and proofs that production provenance/currentness can validate. Baseline-only history is not equivalent: `inventory.rs:activity` explicitly excludes `RevisionTimeEvidence::Baseline`.

### R2: inventory independent of model-evidence spending

Same file:224 — `query_inventory_nine_dense_notes_do_not_spend_model_evidence`.

Preserve **nine allowed notes**, distinct `Dense inventory {i}` titles, initial `"Background context that was already present. ".repeat(80)` body, and **twelve distinct appended findings per note** with the same resulting canonical body. Preserve point creation versus finalized editor-window history and the existing sampled time progression (`1_000_000 + j * 10_000` for the repeated publications); do not collapse twelve revisions into a single final snapshot. Keep the existing out-of-scope `Window` note or an equivalent excluded note.

Unchanged observations: range `1970-01-01` through `2030-01-02` with UTC timezone; real context admission of 24,000 bytes; real normalized inventory call; complete result without continuation; modelEvidence usedBytes stays 24,000; inventory usedBytes remains under256,000; exactly nine unique result rows with the expected ID set; session remains current. Inventory reconstruction/provenance/charged serialization remain production implementations.

The test's contract is not twelve successful save operations by themselves; they supply a dense retained activity/provenance graph that must remain dense under the replacement.

### R3: anchored revision context and scoped cursors

`src-tauri/src/services/note_timeline/tests/history_mode.rs:349` — `revision_context_seeks_and_pages_explicit_lineage_with_scoped_stale_cursors`.

Replace only the initial `save_retained_state` and `1..80` seed loop. Preserve **80 revisions**, first body `first`, subsequent bodies `body {index}`, and titles `Context {index / 10}`. Preserve creation and rename Lifecycle Events interleaved in the explicit predecessor chain. The completed note must point at its final canonical path/identity. A revision-only chain would silently remove the mixed-record part of this test.

Keep every existing assertion and mutation:

- Full100-record page contains more than80 records; choose anchor from record45 onward as now.
- Context exactly31 records, selected revision at offset15, exact record-by-record correspondence to full lineage, relative timeline ordinals15 down to−15.
- Older and newer cursors land immediately outside the current viewport; reverse paging returns the identical context.
- Context cursor rejected by newest-page API; absent anchor rejected; cursor rejected for another anchor, another history generation, and another note scope.
- Successor query plan still uses both `revisions_by_predecessor` and `lifecycle_events_by_predecessor` indexes.
- **Real** `clear_note_history` after obtaining context invalidates the prior anchor/cursor.

Do not seed expected cursor strings or result pages. Cursors, serialization, SQL query plan and comparisons must still come from real read APIs.

## Must-build contracts

| Existing test | Why a prebuilt seed would remove the subject of the test |
|---|---|
| `publication.rs:1084` — `adaptive_checkpoints_are_transparent_across_a_long_revision_chain` | The140 real prepare/publish/mutate/finalize operations exercise adaptive checkpoint placement, encoding, append ancestry and later reconstruction after restart. Keep every iteration and assertions for140 revisions and bodies at0/127/139. Production placement considers replay count, accumulated bytes, delta/full ratio and measured replay cost; a preselected checkpoint layout cannot prove the writer selects a valid one. Existing oracle does not prove specifically which criterion fired; do not strengthen that claim. |
| `publication.rs:1471` — `settled_publications_do_not_retain_full_authored_copies` | Sixteen identical120KB bodies and eight abandoned144KB intents are the data-retention workload. The one-revision count, compacted live bytes<512KiB, clean close and restarted exact body assert deduplication and retirement caused by those operations. Seeding only the desired final rows makes the central storage assertion tautological. |
| `publication.rs:38` — `meaningful_commits_reconstruct_exact_authored_states_after_restart` | Real writes verify source provenance, actual publication-time bounds, authored no-op deduplication, lifecycle creation/predecessor, Unicode/frontmatter normalization and reconstruction. Only three saves; no bulk setup candidate. |
| `publication.rs:202` — `a_cleanly_copied_vault_reconstructs_identical_revision_identity_and_hash` | Initialization and clean-close/copy/open sequence is the portability contract. Existing small fixture should remain executable; it is useful evidence for fixture portability, not a reason to replace that coverage. |
| `publication.rs:739` — `every_app_owned_mutation_source_is_retained_by_the_same_contract` | Each actual source-specific mutation dispatch must produce the expected retained source. Prebuilding source enum values bypasses routing. |
| Remaining publication fault/recovery/concurrency tests, including `concurrent_history_reads_after_restart_converge_one_prepared_publication`, `recovery_retry_waits_for_live_publication_before_and_after_markdown_write`, and `exclusive_creation_never_overwrites_and_abandons_failed_publication` | Live prepared intents, process/recovery state, ownership barriers, and failed-write cleanup are the behavior under test. A completed fixture cannot reproduce their admission transitions. |
| `history_mode.rs:261` — `history_mode_pages_records_with_a_stable_cursor_and_reconstructs_the_selected_revision` | Only five seed revisions, then a real sixth publication while holding a cursor. It also damages an older source to prove bounded page reads do not deserialize unrelated records. Savings are unmeasured and small; preserve this independently understandable writer/read integration owner. |
| `history_mode.rs:321` corruption-gate case and Version Restore tests beginning461 | Post-attestation damage must latch the live gate; restoration must really publish, retain exact bytes and converge across restart. Keep write operations. A larger setup could someday use a valid initial fixture, but none is needed for these current small setups. |
| Inventory activity/provenance and older-task composition cases at6 and292 | Deliberate clock changes, later writes, actual task/provenance eligibility and currentness invalidation are coordinated behaviors, not interchangeable dense seed boilerplate. Keep as integration owners. |

## Proposed narrow fixture API and integration plan

This is a review recommendation, not an approved implementation or new production interface.

1. Add one **test-only** fixture entrypoint beside the existing `note_timeline/test_support.rs` boundary, with a closed scenario enum such as `HistoryReadScenario::{InventorySparse, InventoryDense, InventoryNineDense, CitationContext}`. Return the note identities/manifest needed by the current tests, not a fake `HistoryModeAccess`, fabricated `InventoryResult`, prepared publication token, or configurable event-programming API.
2. Build into each test's existing fresh vault while it owns `TestEnvGuard`; do not add a nested `lock_test_env` acquisition or share an AppState/database across tests. Keep temp cleanup, background worker stop/join, path restoration and injected-fault cleanup under the existing owner. The two sparse/dense iterations must remain isolated from each other.
3. Put any direct completed-store construction entirely inside the private `history_store` test support. Reuse production authored-content serialization/hashing and payload codecs, rather than duplicating delta/checkpoint algorithms. Write a valid complete store with reciprocal window evidence, predecessor/successor data, store/vault identity and generation, current heads and lifecycle paths. Do not export generic raw-SQL seeding through the production timeline seam. The fixture intentionally bypasses writers **only for reader tests**.
4. Materialize real final Markdown files and populate the real catalog via its normal scan/reconciliation seam. Do not insert only history rows: inventory resolves current canonical bytes, catalog identity/path, retained proof and mutation generation. Perform construction before taking read/admission snapshots; if loading requires reopening AppState, close/checkpoint the seed store and bind a fresh state rather than leaving stale verified-head caches.
5. Prefer source-defined deterministic scenario construction to checked-in opaque SQLite blobs. If a prebuilt artifact is chosen instead, provide a reproducible generator using the real writer, a manifest/schema compatibility check, and a clean checkpointed database copy. Copying an open SQLite file without WAL, rebasing current paths by blind string replacement, or copying verification caches is unacceptable. The history schema contains target/current/lifecycle paths, so portability must be demonstrated; the existing clean-copy test is useful but not proof for every dense fixture.
6. Preserve each candidate test body from the first observation onward. Remove only the replaced seed loop and now-unused seed helpers/clock binding. Keep the exact counts and content density. Add at most one narrowly scoped parity check if needed to establish that the fixture represents production-written history; do not generate another large fixture test matrix or re-run the expensive writer generator in every reader test.
7. Coordinator should compare identical reader workloads before/after, including load/materialization/reconciliation cost. Run existing writer tests unchanged and full correctness acceptance. If fixture maintenance or final read workload dominates and savings are not useful, retain current real setup instead of adding a new abstraction for an unproven improvement.

## Evidence and limitations

Inspected full three candidate test bodies, the long-chain and storage-retention bodies, small adjacent publication/history integration tests, existing `TestVault`/`Fixture` lifetime helpers, `inventory.rs` row/byte accounting and activity filtering, private history schema/checkpoint policy, and current production publication/foreground/queue seams from the immediately preceding review. No timings gathered; no additional fixture API exists yet; exact builder internals require owner review against private storage invariants before implementation.

## Coordinator-selected concrete consumer plan

The coordinator selected portable, production-generated archives and this API after the audit above:

```rust
note_timeline::test_fixtures::{load, HistoryFixture}
load(HistoryFixture::{InventorySparse, InventoryDense, NineDense, RevisionContext})
    -> (TestVault, Vec<String>)
```

This supersedes the audit's preference for source-defined completed-store construction; it does not authorize consumer edits yet. The timeline owner audits generator/loader implementation and known path-column portability. Required sequence is private archive copy/rebase before AppState, fresh app-local observation state, then production `ensure_interactive_index` to populate the catalog. `TestVault` owns the sole environment guard and fresh temp lifetime. Do not retain the old manual guard around `load`, because that would recursively lock the non-reentrant test mutex.

Exact call-site changes, after coordinator release:

1. `query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass`: preserve `for dense in [false, true]`; replace manual environment guard, `Fixture::new` and55-note writer loop with `load(if dense { HistoryFixture::InventoryDense } else { HistoryFixture::InventorySparse })`. Derive `allowed: HashSet<String>` from returned IDs. Existing `f.state` observations may stay structurally unchanged with the returned vault named `f`. Everything from request construction through the real clear/cursor-invalidity assertion stays unchanged.
2. `query_inventory_nine_dense_notes_do_not_spend_model_evidence`: replace manual environment guard, fixture creation and nine×twelve writer loop with `let (f, ids) = load(HistoryFixture::NineDense)` and `let expected = ids.into_iter().collect::<HashSet<_>>()`. Preserve request,24KB real evidence admission, inventory result budget/count/identity/currentness assertions exactly. Remove only imports made dead by this edit; other query-inventory tests still require `Fixture`, persistence and clock access.
3. `revision_context_seeks_and_pages_explicit_lineage_with_scoped_stale_cursors`: replace `TestVault::new` and80-revision writer loop with `let (fixture, ids) = load(HistoryFixture::RevisionContext)`. Bind `state = &fixture.state` and the sole generated note identity from `ids` (loader manifest must validate expected cardinality). Keep the existing full page, anchor selection,31-row expected lineage, every cursor/error/query-plan assertion, and real history clear unchanged. Do not return cached expected pages/cursors from the loader.

For inventory scenarios, archive the original additional `Window` fixture note but omit its ID from returned expected IDs. For all scenarios, keep the same authored bodies, revision/window sources, count/density and lineage geometry described above. Manifest validation must distinguish expected allowed notes from total vault notes.

Loader reuse must not silently regenerate a stale or missing fixture during ordinary tests. Regeneration is an explicit generator operation; rejection should identify schema/manifest mismatch. Production-generated receipts, IDs, hashes, timestamps and payload bytes remain immutable after export; only explicitly known portable path fields may rebase. Reject incomplete pending/recovery/missing-note states rather than adding a generic SQL rewriting system.

**Consumer edit release received from coordinator.** Exact plan above is the pre-edit plan; implementation is limited to the three seed sections and required fixture import. No tests/builds authorized for this owner.

## Consumer implementation result

Coordinator-approved edits completed and source frozen. Two inventory tests now call `load` and collect expected IDs; the citation-context test loads its sole note. Removed the converted inventory tests' outer environment guards, because the returned `TestVault` owns that lifetime. Added only fixture shape checks:55 and9 unique expected IDs, and one context-note ID. All other functions are untouched.

Read-only baseline comparison confirms the complete original code from first request/read through the final assertion and clear mutation is **byte-identical in each converted function**. Test counts remain4→4 in `query_inventory.rs` and13→13 in `history_mode.rs`. Physical consumer code is55 lines smaller (411→370 and863→849). This excludes the separate loader/generator/archive cost and is not claimed as total complexity or timing reduction.

Evidence: `consumer-verification.txt`. No tests/builds/benchmarks run; compilation and runtime verification are pending the loader/generator integration and coordinator-controlled acceptance.

## Supplemental dense inventory geometry and repeated-read cost audit

Read-only follow-up requested after the coordinator's initial reader comparison (18.35s versus21.52s); no additional run or source edit by this reviewer.

### What count is necessary?

The sparse branch must exceed the50-row display limit. Its current55 notes provide a nonempty second page; keep55 in this bounded follow-up. The dense branch has **no intrinsic55-note contract**. Its unique boundary is a256,000-byte page admission cutoff, not55 histories. A smaller dense set is legitimate only if it still creates the same continuation topology and byte-stop behavior with the actual charged witnesses.

An exact numeric minimum cannot be derived safely from canonical Markdown byte length. `inventory.rs:239–242` charges serialized `(row, citation, citation, path, title)` plus512 bytes. Each citation contains its excerpt and revision proofs with repeated excerpts; returned row/context are separately bounded to480. `evidence.rs::passage_slices` splits the approximately12.4KB dense body into2400-byte candidates plus a shorter tail. Inventory picks one candidate per note by certainty/time and then **hashed citation ID**, so some chosen witnesses can be shorter than others. IDs/order, serialized proof fields, and private temp-path length affect the actual charge. Equating12.4KB source bytes to12.4KB charged bytes would give a wrong threshold.

Let `p1` be the number of rows actually admitted on dense page1 and `p2` on page2, with the existing note ordering and witness data:

- `p1 + 1` notes is the exact prefix minimum for **two nonempty pages** and one continuation request, provided every individual row is deliverable and the first stop remains `inventory_page_bytes`.
- If the current55-note case reaches a third page, retain **at least `p1 + p2 + 1`** for three nonempty pages. This preserves consuming a continuation, emitting a new continuation at a nonzero offset, and then consuming that new cursor. Two pages would no longer exercise chained cursor advancement; simply observing `pages > 1` is not enough to claim that topology was retained.
- More generally, to preserve the existing number of continuation hops, keep the accepted-row prefix through the penultimate page plus one. Leave modest margin rather than choosing an exact byte knife-edge whose page count changes with a temp-root path or serialization framing.

Therefore the defensible next geometry decision requires **only diagnostic page row counts, charged usedBytes, stopReasons, and continuation offsets from the coordinator's already authorized run**. No new test matrix or guessed count should be introduced. If no such data is retained, keep55 rather than asserting an unverified minimum. Regenerate the archive/manifest explicitly if the approved count changes; do not trim notes in the loader or narrow `allowed` while retaining55 expensive unrelated catalog entries.

### Unique assertions that must survive any smaller dense recipe

Keep original bodies/density and the excluded base Window note. Keep original scope rejection, fresh session/currentness checks, serialized-row≤charged-byte assertion, full union/no duplicates, original search retained once, first `inventory_page_bytes` stop, and real clear-induced stale cursor failure. Preserve every continuation hop actually observed in the baseline when selecting a smaller count; at least two nonempty pages is the literal present assertion, but three pages may own an otherwise-unasserted chained-offset regression. Do not artificially lower the production byte limit or set a tiny per-test row limit, since either would test a different branch.

### Source-visible repeated cost

The repeated work is more substantial than just serializing a few output rows:

1. Each `inventory` call invokes `search_inner(..., collect_only=true)`. On continuation, that path recomputes scope/fingerprint and loops over **all retained `result_ids`**, calling `validate_citation` on every candidate, before returning the existing search key (`evidence.rs:373–406`). It does not validate only the single chosen witness for each returned inventory row. A dense note can contribute several2400-byte candidates.
2. `validate_citation` checks policy/catalog, reads canonical Markdown, parses identity and authored hash, checks text range, performs current-content admission/eligibility, validates retained revision citations, and rereads the canonical file before returning (`evidence.rs:1425–1501`). This is intended freshness behavior, not a trivial cached lookup.
3. Inventory then validates each chosen row's witness again immediately before delivery (`inventory.rs:260`). The test additionally calls `session.is_current` on every page; that revalidates all **admitted** citations accumulated so far and the search scope fingerprint (`evidence.rs:1115`). Initial search also validates the collected candidates and repeats the scope fingerprint after discovery.
4. Every `CurrentContentAccess.read` builds current eligibility from the catalog and checks candidate membership/current runtime version. The retained proof path can rebuild provenance or perform retained-history reads. Thus candidate-count × page-count × scope/proof work is an evident amplification mechanism; its share of wall time is still unmeasured.

Do not remove those test `is_current` calls or bypass production validation to improve a number. They protect privacy, currentness and history-only invalidation. A future production optimization could batch canonical/proof reads within one validation boundary per note, retain final content/generation revalidation, and never cache authorization or bytes across user-visible continuation calls. That would require a separate correctness design and stale-edit/permission regression review; it is outside this fixture edit.
