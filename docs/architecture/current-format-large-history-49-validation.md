# Current-format large-history validation — issue 49

Completed 2026-09-06. Disposable schema-13 fixtures retain 10,000 revisions in one note and 100,000 revisions across 901 notes. All defined backend and native p95 gates passed on the final production code. **Fresh-process recovery of the 100k vault costs about 7.2 seconds**; that startup cost is reported separately from warm interaction budgets.

An initial harness mistake launched an ordinary executable that ignored E2E path flags. Its normal startup changed user metadata file mtimes. No test save/history IPC reached it. No canonical Markdown mtime matched that interval, but no before-hash snapshot exists, so unchanged content cannot be proved. The incident, limits and correction are recorded below; nothing was rolled back, reset or deleted to hide it.

The [machine-readable evidence](current-format-large-history-49-measurements.json) embeds raw sample arrays, selected revision identities, process/command events, storage observations, verified counts, immutable fixture file hashes, source/build identities, earlier stages and failed attempts. Bulky external logs/binaries are referenced by exact path and SHA256. The final check confirmed all owned native/Vite children stopped and ports 1430/4445 had no listeners before these documents were written.

## Workload and durable construction

| Fixture | Notes | Retained revisions | Editing Windows | Creation events | Timeline records | Publications including creation | Retained receipts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10k | 1 | 10,000 | 9,999 | 1 | 10,001 | 19,999 | 10,064 |
| 100k | 901 | 100,000 | 99,099 | 901 | 100,901 | 199,099 | 157,664 |

The 100k vault contains one 10,000-revision hot note and 900 notes with 100 revisions each. This explicitly exercises a long individual history and a many-note vault. Every note is 64 KiB of repetitive Markdown with a deterministically changed first line. Each note starts with a production creation publication. Every subsequent retained revision comes from two distinct ordinary Editor saves within one Editing Window: the second follows 1,000 simulated continuous milliseconds later, then another 300,000 milliseconds are advanced and the real production deadline callback finalizes the window. Real full-file publication, SQLite `synchronous=FULL` preparation, endpoint capture, receipt retirement and finalization remain enabled.

There are no SQL-generated revision rows, old schemas, retired granular Editor writer flags, imported old identities or renamed fixture policies. The current-scale marker is `gneauxghts-current-scale-v1`. Opaque IDs vary across builds; reproducibility means the specified workload/content/counts, current schema and production boundaries. The manifest records actual identities. Verification checks exact per-note/global counts, no unsettled preparations/windows/observations/deletions, retired terminal payloads, foreign keys, SQLite quick checks, canonical managed identities, and matching vault/store/app-observation identity and clean-close evidence.

The 10k master took 635.837 seconds through production generation; its initial command took 669.62 seconds including compilation/export/sealing. The indexed 100k generation took 7,222.515 seconds (120.38 minutes), with progress logged every 1,000 retained revisions and low/middle/high save/seal diagnostic samples. All raw batches remain recorded, including machine variability. Two seconds of read-only OS stack sampling near 55k overlap this generation and are labeled diagnostic. The original untimed seal/check phase took approximately another 310.55 seconds, inferred from the generator/driver log mtimes rather than a dedicated monotonic phase timer.

A seal copies only a stopped writer after clean close. SQLite backup includes any stopped-writer WAL; a nonempty WAL is never ignored via immutable mode. The helper hashes every file, rejects symlinks, binds the outer kind to the validated inner workload and checks all identities. Disposable clones relocate stored filesystem paths only; revision bytes, identities, payload hashes and history generations are preserved. Native and Rust probe admission require a canonical direct temporary child and reject nested symlinks before initializing the application.

## Fresh-process backend results

Each sample uses a separately launched optimized Rust test process and a fresh verified clone. The timer starts immediately before AppState construction and ends after the first recovered History Mode page. It includes production recovery and the mandatory full-vault integrity attestation; it excludes process loader work, fixture cloning/admission, native IPC, frontend initialization and paint. OS/filesystem caches remain warm; no user caches were dropped.

| Fixture | Actual process PIDs | First recovered page, ms | Maximum resident set size, bytes |
| --- | --- | --- | --- |
| 10k | 16259, 16271, 16288 | 558.910, 566.167, 563.384 | 157,302,784; 157,401,088; 159,088,640 |
| 100k | 40138, 40189, 40326 | 7,124.930; 7,163.600; 7,166.229 | 180,666,368; 180,486,144; 179,945,472 |

These are observed process memory values for the specified workloads, not asymptotic bounds or isolated history allocations. Construction's maximum RSS was 238,583,808 bytes. Recovery/startup and memory have no invented numeric release budget.

Full production attestation verifies every retained payload, predecessor/base continuity and result hash once across the entire vault. Each process asserts one exhaustive attestation. Additional byte-for-byte production reconstruction checks creation/latest endpoints plus 20 distributed historical endpoints against fixture content. The 100k interaction matrix samples the hot note and short-note indices 1, 450 and 900; it does not sample every note's UI behavior. All selections/identities are embedded in the JSON.

Each representative has 20 warm samples of each operation per process. The table reports the worst per-process/per-note p95, rather than pooling samples. All 90 budgeted metric groups pass.

| Warm backend operation | Budget p95, ms | 10k worst p95, ms | 100k worst p95, ms |
| --- | ---: | ---: | ---: |
| History entry: page plus latest parent diff | 250 | 35.38 | 39.10 |
| First page of 30 | 250 | 9.04 | 10.13 |
| Old page of 30 via an already obtained cursor | 250 | 7.85 | 8.66 |
| Distributed parent diff | 250 | 29.97 | 32.25 |
| Reconstruction | 1,000 | 6.87 | 7.61 |
| Restore preview | 1,000 | 8.30 | 9.08 |

Obtaining the old-page cursor is not free. Full sequential traversal of the hot note reads 10,001 records in 334 page calls. It took 2,535.964 / 2,358.963 / 2,387.136 ms in the 10k processes and 2,611.297 / 2,674.523 / 2,627.873 ms in the 100k processes. Short-note traversal reads 101 records in four calls, taking 24.784–26.684 ms. These setup costs are explicitly excluded from the already-obtained-cursor samples. Direct old-citation navigation belongs to issue 50 and is not established by these results.

## Native paint results

The final optimized E2E binary was admitted before any child spawn. The runners supplied all three absolute contained roots, verified the exact owned embedded-listener PID and selected vault, then measured ready DOM plus two actual animation frames. Both start and final-frame visibility/focus must pass. Each fixture has five samples per operation, so p95 is the maximum. These timings include Rust, IPC and rendering and are separate from backend timings.

| Fixture | Native PID | Entry p95, ms | Page p95, ms | Diff p95, ms | Budget, ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k | 40517 | 115 | 45 | 49 | 250 |
| 100k / 901 notes | 40747 | 123 | 33 | 65 | 250 |

All 30 measured final surfaces were visible/focused. Both runs operated on the 10k hot note. The event interval from native spawn to verified vault binding was 1.508 seconds for 10k and 14.932 seconds for 100k; it includes application/frontend readiness and harness polling and is not a paint-budget sample. Native startup was not hidden inside a warm-interaction claim. Every owned app/Vite process was stopped, and each sealed master was rechecked afterward.

## Storage

| Clean-close construction observation | 10k bytes | 100k bytes |
| --- | ---: | ---: |
| Main SQLite file | 61,923,328 | 607,735,808 |
| WAL | 0 | 0 |
| SHM | 32,768 | 32,768 |
| Allocated index pages (`dbstat`) | 22,429,696 | 221,614,080 |
| Retained compressed revision payload | 537,459 | 5,381,259 |
| Reclaimable pages | 65,536 | 65,536 |

Each accepted clone also records open/closed main/WAL/SHM sizes in the JSON. Path relocation and the new derived index can change allocation/freelist sizes. The storage observer opens a diagnostic connection, so its SHM allocation can be its own live sidecar even after application clean close; the sealed file manifest records the actual exported files separately. File sizes are allocation observations, not cumulative device writes, fsync counts or write amplification. Repetitive content compresses strongly; incompressible histories were not tested.

## Targeted fixes and validation safeguards

The first 100k generation was stopped after roughly 15k retained revisions when OS sampling and EXPLAIN on a copied sealed database identified the pending-publication guard scanning all retained `prepared_intents` for each save. The production fix adds a partial index on `prepared_intents(note_id) WHERE status = 'prepared'` after current schema/identity/generation/observation admission. Existing current-format stores acquire the derived access path too. The direct-table guard is unchanged: a corrupt orphan preparation without a receipt still blocks another publication. There is no schema-version change, legacy migration, changed durability boundary or retained-revision semantics.

A regression first failed with a SCAN, then passed with indexed SEARCH and orphan-preparation rejection while canonical bytes remained unchanged. A fixed production workload alongside a sealed 10k clone measured 200 saves and 100 seals before/after: save p95 20.28→15.61 ms, seal p95 11.70→8.30 ms, whole probe 5.32→4.07 s. These are diagnostics without an invented save SLA. The first partial build is preserved as a stopped diagnostic snapshot; the accepted 100k fixture was generated from scratch. Near 55k in the accepted generation, 93/161 worker samples (57.8%) were canonical `atomic_publish_note → File::sync_all → fcntl`; only one contained the prepare frame, without the earlier broad scan branch. This bounded profile supports durable canonical publication as the dominant sampled cost, not a whole-run I/O measurement or a further demonstrated query defect.

The test helper separately scanned retained intents three times per note during admission. After the original seal completed, it was changed to one grouped scan with exact manifest scope accounting and the same per-note bounds, exact counts and retired-payload checks. A focused regression rejects a deleted per-note intent, live payload bytes and an outside-manifest scope. The unchanged sealed 100k master then checked in 1.147 s, 10k in 0.096 s and the historical 95-revision master in 0.008 s. This helper change affects untimed fixture admission only.

The demonstrated ordinary-binary launch risk was closed across all native entry points. `buildNative.mjs` immediately copies each successful feature build into `target/e2e/{debug,release}/` with a hash/profile manifest. WDIO and process-relaunch runners admit that isolated artifact before spawning; the scale runner additionally requires an explicit admitted evidence artifact. Ordinary Cargo output cannot replace that copy. Tests reject ordinary bytes despite a forged E2E label, changed hashes and profile mismatch, and verify an ordinary Cargo overwrite leaves the admitted copy intact. An actual admission-only check rejected the mutable Cargo path and wrong profile before launching any child. No compatibility alias for old disposable manifests remains.

Validation passed: 195 focused Note Timeline tests (seven ignored fixture/probe tests), 16 architecture checks, ordinary `cargo check`, eight Python fixture tests, seven Node admission/containment tests, optimized frontend/native build, six fresh-process backend probes and both native paint runs. The production Rust source did not change after indexed backend validation. Post-construction changes were shared native admission, helper aggregation and documentation; source manifests distinguish construction from final harness stages.

## Failed attempts and unintended default-app startup

1. Initial 10k generation/sealing succeeded, but `/usr/bin/time -l` returned status 1 because the sandbox denied `kern.clockrate`. That attempt has no RSS value. The original generator binary was overwritten before its hash was captured; its command/profile, full log and immutable fixture hashes are preserved, and no missing binary identity is invented.
2. An exploratory 10k backend probe preceded tightened clone containment. Later pre-index probes superseded its admission stage; indexed PIDs 16259/16271/16288 are the accepted production backend stage. Earlier pre-index native PID 7776 and its passing metrics remain explicitly labeled historical stage evidence.
3. A normal `cargo test --release` replaced the first mutable native build with an ordinary binary, SHA256 `c38effaac4b0f5466b22182a15376d7afec487ea81762043e3406852df231314`. The initial harness launched it as PID 4265 at 20:16:30.417 UTC and stopped it at 20:17:00.470 UTC after no embedded listener appeared. It ignored E2E overrides and performed normal startup against the user's selected vault/app-data; no test save/history IPC was issued.

   Read-only file inspection confirmed metadata mtimes changed during that interval for the app-local history observation record, vault manifest, history/app-state/semantic databases and ANN cache. No canonical Markdown mtime matched the interval. There are no before hashes and no database-row comparison, so neither unchanged file content nor particular semantic row changes can be proved. The inspection did not open user databases; nothing was reset/restored/reverted/deleted. Sanitized paths/sizes/timestamps are embedded in the JSON. The newly orphaned checkout-bundled llama-server PID 4296 was stopped only after its exact executable/start time matched this owned launch; absence was verified. Older unrelated processes were untouched.

   The original wrong executable was already overwritten before an actual-file negative admission test could be retained; it was not rebuilt just for that test. Its hash/missing E2E strings/startup evidence and the synthetic ordinary-byte regression are preserved. Shared copied-artifact admission now protects all native harness entry points. Ordinary product startup behavior was not changed.
4. The first binary preflight required a runtime-environment string absent from the actual E2E executable. It rejected the artifact without launching anything; the guard was corrected to the observed embedded driver's compiled port marker. The old pre-index artifact/manifests remain historical evidence.
5. The first 100k generation was deliberately stopped after the verified global scan diagnosis. Its progress, OS-sampling overlap, ownership/stop evidence and complete stopped-copy main/WAL/SHM snapshot are retained separately from the accepted master.
6. Before the indexed 100k generation, an actual display check reported locked. No native child was launched; native measurements were deferred until actual unlocked checks passed. This was a no-launch readiness block, not a paint budget failure.

## Reproduction, identities and limits

[Native/large-fixture instructions](../../e2e/README.md) document explicit `create-scale`, clone/probe and `native-scale` commands. Exact accepted command arrays and env roots are embedded in the JSON. Evidence files live under `/tmp/gneauxghts-current-scale-49-evidence`; sealed masters are `/tmp/gneauxghts-current-scale-v1-10k-issue49` and `/tmp/gneauxghts-current-scale-v1-100k-issue49`.

The final native artifact SHA256 is `6c653eb5a807f121e46d1febc46a1a6c7924a86e5c295edc45ee0231fcb3c5e6`. Final source/test-binary/manifest/log hashes and every sealed fixture file hash are in the JSON. The four original release evidence files and the 95-revision issue-43 master retain their previous hashes; issue-47/48 evidence was not rewritten.

Hardware: Mac16,8, Apple M4 Pro, 12 CPUs, 24 GiB RAM, macOS 26.6.2 (25G83). This is one desktop with normal background processes and warm OS caches. No CPU isolation, slower-hardware run, Windows/Linux native paint, OS-cold storage, physical power loss, cumulative device I/O, incompressible 64 KiB scale history or combined 1 MiB/10k note is claimed. The 901-note shape is explicit, not proof for every vault distribution. Old-citation navigation and deferred issues 22/24–26 remain outside this ticket. No commit was created.
