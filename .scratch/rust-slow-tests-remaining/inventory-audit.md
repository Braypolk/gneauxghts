# Inventory pagination: measurement and bounded options

Progress: Read-only investigation complete; measurement plan ready for coordinator review. No source edits, builds, tests, or timing runs performed. Root owns all execution.

## Contract and current cost

Target: `query_inventory_continues_across_budgets_without_duplicates_or_scope_bypass`, `src-tauri/src/services/note_timeline/editing_window_capture/tests/query_inventory.rs:106–208`.

The same scenario runs against sparse and dense portable fixtures, each with 55 allowed notes plus the excluded Window note. Sparse must exceed the actual 50-row display limit; dense must exceed the actual 256,000-byte conservative admission limit. Every returned page must be nonempty, serialized rows must remain within that byte limit and the reported charge, admitted evidence must remain current, rows must be allowed and globally unique, continuation must reuse the one retained search, a changed excluded scope must reject the cursor, completion must eventually cover the exact allowed set, and history clear must invalidate a saved cursor. The loop permits at most nine pages and requires more than one; it does **not** require three pages or 55 dense rows as a semantic contract.

Production inventory limits live at `services/evidence/inventory.rs:5–6`. Its byte charge is serialized `(row, citation, citation, path, title)` plus 512, not the displayed row or canonical body size. Candidate choice is per-note and may select different passage slices by citation ordering. Consequently a dense note count cannot be safely calculated from the recipe's `repeat(400)` alone; measure admitted charges and boundaries.

Continuation `evidence.rs:374–397` validates **all retained candidate IDs**, not merely one inventory witness per note. `inventory.rs:258` then validates each witness to be delivered, and explicit `is_current` at `evidence.rs:1115` validates accumulated admitted citations plus scoped fingerprints. `validate_citation` at `evidence.rs:1425` checks scope, resolves current catalog identity, reads and parses canonical content, validates hash/range, performs current-content eligibility and revision proof checks, and rereads canonical bytes. Dense notes amplify the number and size of these validations. Changed-scope attempts may reject at the earlier fingerprint/binding check; they should be timed separately from successful continuations rather than counted as equivalent full work.

The previous cold-catalog batch experiment is already implemented in `note_timeline/tests/fixtures.rs:285–299`: foreground guard, real prewarm, existing lexical `sync_with_notes_index`, release, and queue idle. Do not propose it again as new savings. Loader work still includes decode, digest verification/extraction, path rebase/VACUUM, geometry validation, fresh AppState, and final projection readiness.

## Minimal measurement plan

Instrument temporarily and remove measurement code after the experiment. Prefer a few aggregate spans and counters over per-citation logging that changes timing materially.

1. At the test boundary, separately time `load` for sparse/dense, each successful `inventory` call, each `is_current`, each denied-scope call, final clear-plus-stale-cursor check, and fixture drop. For every successful page log scenario, page offset, row count, used bytes, limit bytes, stop reasons and continuation presence. Log retained candidate count if cheaply available within existing private scope. This establishes whether setup or repeated proof work dominates and gives the current geometry.
2. Only if inventory dominates, add aggregate nested spans inside `inventory`: `search_inner`, grouping (initial page), and row validation. Inside continuation `search_inner`, separately record fingerprint and the all-candidate validation loop, including candidate count. This is sufficient to choose a fixture-only change versus investigate production work; no permanent metrics API is needed.
3. To locate the dense boundary without regenerating archives first, run a temporary root-owned experiment using deterministic subsets of the existing dense fixture's allowed IDs. Sort IDs before selecting, keep the excluded Window, and retain all original assertions except the deliberately varied setup cardinality. This still exercises real 256,000-byte admission and all cursor/currentness checks, while holding archive load constant. It isolates query cost from generator/load cost. These experimental subsets are not the proposed final fixture until the boundary and source recipe are reviewed.

Do not run a count sweep blindly: first observe the current first-page row count and charges, then probe a count above that boundary with a margin. Preserve at least two actual pages, nonempty final page, first stop reason `inventory_page_bytes`, and complete exact-set delivery. A regenerated fixture has new durable IDs/citation ordering, so rerun the page measurements against the actual final archive rather than assuming a subset's boundary transfers exactly.

## Concrete options in preferred order

### A. Smaller dense geometry; sparse remains 55

The sparse 55-note fixture is intentional row-budget coverage and stays unchanged. Dense 55 has no corresponding production count boundary; its essential size requirement is crossing the real byte budget with individually admissible witnesses. If measurements show many extra dense validations/pages beyond this requirement, reduce dense geometry to a conservative measured count, preserving all assertions listed above and the excluded Window. Keep the current body density unless a separate demonstrated need calls for changing it; simultaneous count and body changes obscure the cause and may select short witnesses.

Required final changes: separate the `InventorySparse`/`InventoryDense` geometry arms, adjust only the dense generation recipe count, regenerate its canonical-produced archive through the existing generator, update the archive's declared geometry/digests and documented recipe, and change the target test's setup cardinality assertion to the explicit per-scenario count. The current shared recipe version may require regenerating other archives if bumped globally; inspect version semantics before causing unrelated churn. Never patch immutable archive IDs, revision data, payloads or timestamps directly. Do not delete 55 files from a restored fixture while leaving catalog/history membership inconsistent.

An alternative final implementation scopes a smaller deterministic subset of the existing 55-note dense archive. It avoids archive churn and preserves outside-scope distractors, but continues paying full restore/catalog cost and leaves a misleading oversized recipe. Prefer it only if measured query savings dominate and retaining a larger catalog is explicitly useful to the scope contract. Do not present it as reduced fixture I/O.

### B. Reuse proof work within one operation only if measured and proven safe

There is visible repeated validation between continuation's all-candidate check and inventory's witness check, but those calls are separated in time. The second check currently detects canonical edits and proof changes after the first. `CurrentContentAccess` uses start/end versions rather than holding an exclusive read lock over the entire inventory call; external file edits also need byte checks. Merely caching `validate_citation` results by citation ID, or passing a `validated=true` flag from search, would remove an observation boundary and is not an acceptable bounded optimization.

A legitimate future improvement would share parsed canonical content/proof reads only inside a coherent validation operation with an explicit final scope/version/byte recheck. It must still validate every retained candidate on continuation (including an unreturned candidate that changes), reject history-only clear and permission changes, and preserve final witness freshness. That requires a small API design and targeted race verification, not an opportunistic deletion. Measurements should first separate candidate-wide validation from duplicate witness validation: the latter may be a small fraction, making the rewrite unjustified. No production rewrite is recommended before those measurements.

### C. Keep current geometry if no safe material gain appears

Do not weaken the real byte limit, force a lower test-only budget, remove page-level `is_current`, skip negative scope calls, stop after one continuation, or remove the history-clear invalidation assertion. If fixture load dominates and archive shrink saves little, or the smaller final archive cannot reliably cross the byte boundary with a comfortable margin, retain this test and report the measured limit honestly.

## Acceptance for an agreed change

Keep test inventory unchanged. Preserve sparse display-row stop and dense byte stop, real budget value, nonempty progress, no duplicates, exact allowed-set completion, one retained search, per-page currentness, scope-change rejection and history-only invalidation. Record before/after setup and query timings separately, archive size/geometry if changed, and exact final page counts/charges. Root runs focused and integration checks; this audit makes no unmeasured speed claim.

## Temporary measurement instrumentation

Coordinator-approved instrumentation is now installed only in the target test and frozen for root execution. `REMAINING_PROBE` JSON lines report sparse/dense load; successful page inventory duration with offset, rows, budget charge/limit, stop reasons, continuation/completion; per-page currentness; denied-scope continuation; history clear; stale-cursor rejection; and explicit fixture destruction after all original assertions. Durations are microseconds. No subset or geometry changes were made. All assertion expressions remain; baseline comparison confirms no bytes outside this function changed. This probe is temporary and must be removed after the measurements. No test/build runs by this agent.

## Approved dense subset experiment

Root's `probe-before.log` run reports dense 55 as four pages (15/15/15/10), sparse 55 as two pages (50/5), with dense query validation dominating. Before further source edits, the agreed experiment is to sort the loaded dense fixture IDs and truncate to 20 before forming the allowed set. Sparse remains all 55. The test's explicit setup cardinality will be 20 dense / 55 sparse; every pagination, real-byte-budget, currentness, scope, exact-set, retained-search and history-clear assertion and every temporary probe remains intact.

This deliberately leaves the 55-note archive and catalog unchanged to isolate query savings. It does not claim fixture load savings. Root will run the candidate; only if supported will the fixture owner regenerate a coherent 20-note dense archive, followed by a fresh actual-archive boundary check. No production validation cache is proposed. This is a temporary experiment, not the final fixture implementation.

## Final reader change after measured subset

Root reports the 20-note subset experiment passed: dense first page returned 16 rows with a conservative charge of 249,869 bytes and `inventory_page_bytes`; the second page returned four rows and completed. Combined sparse+dense real work was approximately 4.7 seconds in that run. This is an observed subset result, not a final regenerated-archive measurement; new durable IDs may alter the representative witness and exact page split.

Approved final decision: consume the coherent dense 20-note archive being regenerated by the fixture owner, retain sparse 55, and preserve all existing behavior assertions. The reader now expects the corresponding exact cardinalities; it does not sort/truncate IDs. An additional dense first-page assertion requires fewer than 50 rows, making byte-budget rather than row-budget termination explicit alongside the existing required `inventory_page_bytes` reason. Every temporary probe is removed. The target test retains its name and inventory. The only final reader differences from phase baseline are the per-scenario cardinality and this stronger first-page assertion; all other original assertions and calls are restored unchanged.

Reader source is frozen for root validation. The fixture owner owns geometry/generator/archive/README changes. No tests or builds were run by this agent. Root must verify the actual regenerated archive crosses the real byte limit and completes without any weakened freshness/scope/history-clear assertions.
