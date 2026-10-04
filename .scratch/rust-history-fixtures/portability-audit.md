# Immutable history fixtures: portability audit

Status: ready-for-agent
Progress: Read-only audit complete. Reuse is viable for read-oriented scenarios through isolated copies of cleanly closed, production-generated vaults.
Owner: audit_timeline

## Decision and boundary

Prebuilt histories can remove repeated canonical seed work from reader tests without inventing history records. Generate each master once through the real note publication/finalization seam, cleanly close it, validate and hash the export, then copy it into a fresh disposable vault for each test. The master must never be opened by AppState. Each copy still enters normal runtime recovery, admission and verification. Keep writer/checkpoint/recovery tests building their own histories; a prebuilt checkpoint cannot validate today's checkpoint-generation policy.

Reviewed CONTEXT, ARCHITECTURE, behavior invariants around clean close/portability, ADR0004 and ADR0005. Their contract is sequential clean-close portability, not live SQLite copying. No source edits, builds or tests were performed. Root owns measurements and final scope; the parallel contract audit owns exact reader assertions.

## Existing reusable precedent

- `services/note_timeline/tests/publication.rs:202`, `a_cleanly_copied_vault_reconstructs_identical_revision_identity_and_hash`, already proves a clean copy consisting of Markdown, `vault.json` and the main history database can reopen with fresh app-local observations and preserve Revision Identity, content hash and reconstruction.
- `release_validation/current_scale.rs:45–168` and `release_validation/windows.rs` contain opt-in production generators, clean-close/export operations and fresh-process readers. They generate much larger geometries than the proposed unit fixtures; do not run them just to acquire small reader data.
- `scripts/timeline_fixture.py` already provides immutable-master digests, schema14/count/identity validation, stopped-writer checks, SQLite backup during seal, source-root metadata, disposable copies and path relocation. `scripts/tests/test_timeline_fixture.py` covers damaged master, inconsistent identity and clone safety. Existing script accepts only its two named scale kinds and exact geometries; it is a precedent to extend narrowly or mirror in test-only Rust support, not an already-compatible loader for these reader cases.
- Existing clone code rebases `timeline_heads.current_path`, `prepared_intents.target_path` and `lifecycle_events.{path,previous_path}` in the disposable copy. It never rewrites Revision payloads, hashes or identities. For new masters, prepared intents must be empty; do not normalize recoverable state into a supposedly settled fixture.

## Concrete proposed shape

Use a narrow `cfg(test)` fixture enum/loader, for example `load_history_fixture(ReaderFixture::InventorySparse)` rather than a generic database-seeding API. Candidate geometry names are sparse inventory55, dense inventory55, dense activity9×13 retained states, and revision context80 with real rename events. The exact contract audit decides eligibility; the adaptive140-checkpoint test remains generated live.

Each versioned master contains:

- Canonical Markdown files, with their managed Note Identities intact; required relative assets only if its scenario uses them.
- `.gneauxghts/vault.json` and a settled main `.gneauxghts/history.sqlite3`.
- A small recipe/contract manifest: fixture kind/version, original canonical vault root, current history format/schema/generation, Vault Identity/store instance/clean-close sequence, note IDs with relative current paths, revision/lifecycle counts and selected identities/hashes, generation provenance/recipe revision and digest of every payload file. Record captured time bounds explicitly.

Prefer checked-in small immutable fixture artifacts or a clearly versioned local cache materialized by an explicit generator command. Default tests should load deterministic known masters, not regenerate a missing fixture silently or contact anything external. This audit does not choose artifact size/storage policy without measuring generated sizes. Regeneration must be reviewable and invalidate the manifest; a schema mismatch is a clear regeneration error, not permission to patch the schema number.

Loader order:

1. Acquire existing environment guard; retain it through all runtime teardown. Create fresh notes and app-local directories. Verify master digests, exact kind/schema and file allowlist; reject symlinks/unsupported files. Never mutate the master.
2. Copy canonical Markdown/manifest/database into the unique canonical temp root. Ordinary copies or a proven copy-on-write clone are safe; hardlinks are not, because test writes could mutate the master inode.
3. With no AppState/database writer open, rebase only approved path geometry in the copied database in one transaction: `timeline_heads.current_path` and `lifecycle_events.path/previous_path`. Match the exact old-root-plus-separator prefix, require expected under-root paths, preserve NULLs, and leave content untouched. Validate every affected non-NULL path stays within the clone; do not use unrestricted string replacement across SQL/text/payloads.
4. Close relocation SQLite handles before AppState construction. Use a fresh empty app-local observation directory. Bind AppState to the copied vault using normal RunningVault resolution; keep Vault Identity, store instance, history generation and clean-close watermark unchanged.
5. Populate the current note catalog/projections via the existing production reconciliation/prewarm path required by the reader, not a second handwritten index. Drain actual queued projections where the scenario observes them. Verify startup/reconciliation did not append unexpected revisions or lifecycle records and canonical content hashes match the fixture contract. Existing runtime verification must remain enabled.
6. Return the fixture owner plus manifest-backed note IDs/relative paths, so tests select intended records without assuming generated UUID values or source-root paths. Existing cleanup stops/joins projections and disposes runtime before deleting directories/restoring global paths. Test actions such as clear mutate only this disposable copy.

No app-state database, semantic database, lexical cache or source app-local observation file is required for these settled read-only histories. Creating fresh app-state storage avoids transplanting unrelated navigation/task path state. If a future fixture explicitly needs such state, that is a different fixture contract with complete path inventory; do not widen this loader implicitly.

### Coordinator's compact archive proposal

The proposed `note_timeline/test_fixtures.rs` under `cfg(test)`, with a zstd-compressed JSON archive of `BTreeMap<relative filename, bytes>`, needs no new dependency and fits this design. Keep archive format/recipe version separate from history schema; include the manifest metadata above rather than returning unexplained positional IDs alone. A small TestVault constructor accepting a pre-AppState initializer is sufficient: after temp paths/global overrides are established but before AppState binding, the initializer copies/rebases/validates the fixture. Retain ordinary `TestVault::new` as its no-op initializer caller; do not turn TestVault into a generalized configuration framework.

For this loader, call `state.ensure_interactive_index(notes.path(), "history-fixture")` once after AppState creation. `index.rs:379–417` performs a cold full refresh, and `run_full_refresh` supplies a no-op history observer before synchronous catalog/lexical/task projection (`index.rs:480–560`), so this path does not invent history observations or new revisions. This is needed for inventory: `services/evidence.rs:178–206` derives allowed note IDs directly from `notes_index`; copying files alone leaves that scope empty. Fresh catalog generation/fingerprints are correct for each clone. The call performs real per-note lexical work, so measure load cost rather than assuming disk-copy time is the entire new setup cost. History admission/verification still happens through the subsequent real timeline reader. Assert expected catalog IDs/relative paths and unchanged history cardinality/hash to make initialization loss visible.

## Admission, WAL and schema constraints

`history_store::clean_close` (`history_store.rs:3551`) settles recoverable intents, rejects remaining pending windows, marks portability `portable`, advances the close sequence, checkpoints/truncates WAL and closes its connection. The public `NoteTimeline.clean_close` also owns the operation barrier/window finalization. Generation/export must call that public seam successfully and stop/drop AppState before copying. A read after clean close through another owner could mark the store open again; export validation must explicitly read `portability_state == 'portable'` without production-opening the source.

The existing Python validator pins identity/schema/counts but does not itself select the portability-state column. Do not assume its matching observations alone prove the stronger fresh-install fixture contract. Add explicit portable-state validation for the proposed kind. A master must have no nonempty WAL. Either require the clean-close main database with absent/empty sidecars, or use SQLite backup only from a demonstrably stopped source and then validate the resulting master; never copy a live main file and discard WAL. Do not use immutable SQLite reads to hide a nonempty WAL.

`validate_and_remember_history_selection` (`history_store.rs:3813`) rejects an open store on a fresh app-local installation, rejects changed store instance at one generation and rejects an older clean-close watermark. New clones should use fresh observations, which exercises portable admission naturally. Reusing the source observation file is unnecessary and could accidentally allow an open fixture; reusing a prior test's observations would also make repeated copies look like rollbacks. No observation reset or admission bypass is required.

Manifest and DB must agree on Vault Identity, format and generation. Current code supports only the exact current schema (14 at audit time), rejecting old/incomplete metadata before schema writes. Preserve opaque identities and receipt sequences rather than regenerating them in the clone: all Revision, predecessor, restore-origin and receipt references depend on them. Same identities across independent temp vaults are safe because tests are isolated, but these copies are never combined into one live vault.

## Path inventory and settled-fixture restrictions

Raw copying without relocation suffices for identity-only reconstruction but is insufficient for current-content evidence: history `timeline_heads.current_path` would still name the generator's temp path. The existing portability test does not prove current-path evidence access after relocation. Rename-context tests also require previous and current lifecycle paths to describe the clone consistently.

For the first small loader, require these tables empty: `prepared_intents`, `pending_window_preparations`, `pending_editing_windows`, `pending_observations`, `pending_deletions`, `missing_notes`, `baseline_initialization_failures`, and deletion markers if not explicitly part of the fixture. Require no live/prepared publication receipts and no pending reset rebuild. Then only heads and lifecycle paths need relocation. Missing-note/purge fixtures have captured deadlines and additional path columns; interrupted-publication fixtures have authored recovery bytes/paths. Neither should enter this simple loader.

Authored Markdown may itself contain absolute links. Changing those would alter canonical bytes and hashes; restrict initial recipes to relative/no embedded source-root paths and reject unexpected occurrences outside the allowed DB geometry. Do not rewrite content to make a fixture portable.

## Time and filesystem metadata

Preserve all durable revision timestamps, lifecycle times, window evidence, creation metadata and identities byte-for-byte. A clone-time clock shift would manufacture different historical evidence. Store captured bounds in the manifest and use appropriate explicit test query periods; avoid relying indefinitely on the existing2020–2030 upper bound or on today's date. A synthetic fixed time must be supplied through existing generation clock controls, not post-hoc SQL timestamp edits. The Editing Window test clock and actual publication wall clock are different inputs; validate both bounds in the generated contract.

Filesystem mtime may change on copy. For these fixtures, canonical managed metadata/history must remain authoritative, and post-load reconciliation must leave revision counts unchanged. If a scenario specifically observes filesystem modified time, preserve it explicitly and assert it, or keep that scenario live-generated. Exclude retention/purge-expiry scenarios from reusable settled readers because advancing real time changes eligibility.

## Validation required before adoption

Generate each candidate once with real canonical operations and preserve its original shape/assertions. Load two separate copies and prove their canonical hashes, note/revision IDs, counts, lineage and current paths; mutation/clear in copy A must not affect copy B or master digests. Include fresh-observation portable admission, correct rebase, unsupported schema/hash corruption rejection and master symlink refusal in focused loader checks. Then run unchanged reader behavioral assertions and compare identical serial workloads, including clone/admission/projection costs. Retain current live generation tests for creation/window/checkpoint/receipt/rollback/restart and corruption boundaries. This is reader setup reuse, not replacement of production write-path validation.

No source/build/test operations were performed by this investigator. This design requires coordinator approval and implementation/measurement evidence before claiming speedup.
