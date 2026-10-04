# Independent design and Standards review

Progress: Complete. Final frozen five-source-file diff, fixture archives and README reviewed; no actionable Standards/design findings. Coordinator focused run passes all three targets; mutation/repeat/full acceptance remain coordinator-owned.

## Scope and standards

Reviewed this phase's `spec.md`, three audits and child plans. Compared current Rust sources with the saved `src` subtree at `/var/folders/kt/bvxdjthn7558236cmffqpndm0000gp/T/gneauxghts-remaining-tests-baseline-nyoc_iyr` using Python difflib, not the accumulated Git changes. Also inspected existing fixture loader/export validation, the actual adaptive checkpoint policy, compaction and retained behavior owners.

Standards sources remain AGENTS.md, the repository code-review skill (including judgment-only Fowler smell prompts), ARCHITECTURE.md, behavior invariants, and ADRs 0004/0005/0008. No tests, builds, benchmarks or source edits performed by reviewer.

## Final assessment

No actionable design or Standards blocker found in the retained implementation. Final source contains no temporary timing/probe instrumentation. The only history-store additions are two cfg(test) read-only observers; no production checkpoint, durability, verification, compaction or freshness algorithm changed.

### Checkpoint prefix

The proposed 127-revision archive is a legitimate **precondition**, not a precomputed passing checkpoint outcome. It ends at replay126. Current production operations must still write live index127 as a delta, index128 as a checkpoint, and129–139 as deltas. Starting from128 archived rows instead would conceal an erroneously early threshold; the implemented127 boundary avoids that gap. The original measured workload reached only replay57 after83 early checkpoints, so the new oracle establishes a boundary the original did not prove.

The retained test uses real preparation, canonical `fs::write`, mutation and Editing Window finalization for all13 live writes. It rejects warnings, closes the original timeline, joins projection work and constructs a new AppState before reading all140 revisions and reconstructing0/127/128/129/139. Stored policy assertions execute after reopen. No target output row is fabricated, and the fixture helper only reads policy.

The existing archive infrastructure checks recipe/schema/kind/geometry, per-file SHA256, allowlisted paths, SQLite consistency, settled receipts/windows and managed canonical identity; normal loader execution does not regenerate stale inputs. Prefix loading adds root/delta policy checks and endpoint reconstruction through actual history admission. Generation uses real canonical saves/finalization and clean-close export. Only disposable path relocation changes stored rows; authored payloads, hashes and identities stay intact. This follows ADR0004/0005 boundaries.

Accepted coverage tradeoff: ordinary runs no longer execute the first127 publications. Unchanged owners include `every_app_owned_mutation_source_is_retained_by_the_same_contract`, `committed_markdown_survives_finalization_failure_and_recovers_once`, `publication_failure_creates_no_revision_and_restart_abandons_the_intent`, `a_cleanly_copied_vault_reconstructs_identical_revision_identity_and_hash`, and Editing Window publication/recovery tests. None of those replaces the new live threshold assertions; together they retain ordinary write/restart coordination while the fixture supplies only earlier history.

Final artifact and README inspection confirms this narrow checkpoint precondition is explicit. Mutation checks for missing and prematurely lowered128 policy remain with the coordinator. Exact delta assertions may legitimately fail if the real50ms adaptive-time branch triggers on a severely loaded host; no test clock or policy override conceals that. Report measured repetitions rather than claiming universal timing independence.

### Inventory

Sparse55 still crosses the real50-row boundary. Final dense20 now loads a coherent regenerated archive, not a truncated subset of55. First-page `inventory_page_bytes`, serialized256000-byte ceiling, charged-byte bound, multiple pages, currentness, one retained search, no duplicates, exact allowed-set completion, rejected changed scope and history-only invalidation all remain. The final source additionally requires the dense first page to contain fewer than50 rows, excluding a coincident row-limit stop. The real regenerated archive passed the coordinator's final focused test, so its actual durable ordering preserves the byte-boundary assertions. Excluded Window remains the out-of-scope witness. No validation cache or production freshness boundary is removed.

### Storage

Four32KiB SHA256-derived bodies are a small deterministic local fixture, not a general generator abstraction. They still traverse real writes/finalization and real SQLite clear/compaction. Their high-entropy content avoids incidental repeated-line diff cost. The new post-clear `page_size * freelist_count >32768` condition distinguishes physical free pages from reclaimable WAL bytes; remaining bytes after the first pass make the existing32KiB per-call ceiling non-vacuous. Logical allocation retention, actual shrink, eventual zero, BaselineInitialization and deletion marker assertions remain. Coordinator candidate evidence records20 free4096-byte pages after clear and12 after the first pass, preserving a physical margin above32KiB. Probe-only timing/printing is removed from the retained implementation.

## Maintenance assessment

The narrowly named checkpoint kind/body helper and private read-only policy query reuse existing fixture ownership without a new framework. No production interfaces, fsync changes or alternate writers appear. Per-kind recipe versions change only dense inventory to2; unchanged kinds and new prefix remain1. This avoids unnecessary regeneration of unrelated immutable inputs. Additional recipe cases are justified by distinct actual geometry; introducing polymorphism or a generic fixture DSL would increase burden. No actionable Fowler smell is established by the retained design.

## Artifact verification and limits

Read-only zstd/JSON inspection independently verified all embedded SHA256 file digests and declared schema14/recipe/geometry. Checkpoint prefix is `[1,1,127,1]`, contains three files, and its canonical Markdown ends at revision126; its archive SHA256 is `71c1e1a195e248faa0777f2ddd5e5510a22e33fd7aac2319238175de515ab127`. Dense inventory is recipe2, `[20,21,21,21]`, contains23 files, and its archive SHA256 is `fc90ac1641e7dc50453695887d58605683e2899e28fd768e1accee3166555136`. Sparse inventory, nine-dense and revision-context are byte-identical to the phase snapshot. README matches all five geometries, regeneration behavior and the live checkpoint boundary tradeoff.

Observed coordinator `focused-final.log`: all three retained targets pass in5.54s test execution, following15.14s compilation. This reviewer ran no tests/builds. Full runtime schema/reconstruction validation executes in the real loader and was exercised by that coordinator run; independent artifact inspection here checked bytes/metadata, not a separate database validator. Mutation sensitivity and repeated/full acceptance results remain outside this source-review claim.
