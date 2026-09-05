# Note Timeline release validation

Issue 23 validates the completed initial feature, including History Mode Version Restore and current-content chat evidence. Chat-requested restore grants/proposals remain deferred under issue 22.

## Reproduce

Run frontend generation before the browser/native suites, and run those suites sequentially. Vite and SvelteKit share generated files: starting another frontend suite or `pnpm check` during a native journey can reload its page.

```sh
pnpm check
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e:browser
pnpm test:e2e:native
pnpm test:timeline:scale
pnpm test:timeline:scale:render
```

For a shorter optimized large-note diagnosis:

```sh
cargo test --release --manifest-path src-tauri/Cargo.toml release_large_note_latency -- --ignored --nocapture
```

The ignored `release_retained_scale_latency` diagnostic can consume a preserved synthetic 100,000-revision fixture through `GNEAUXGHTS_RELEASE_SCALE_VAULT` and `GNEAUXGHTS_RELEASE_SCALE_DATA`. Both paths must be direct children of the canonical temporary directory, with the harness's `gneauxghts-release-scale-vault-` / `gneauxghts-release-scale-data-` prefixes. Stop the creating process before opening them. The diagnostic runs the same read/recovery phase as the full harness, including destructive clear of the synthetic hot note. It is not a backup or portability tool.

Scale tests are explicitly opted into because they make 100,000 durable revisions and assert hardware-dependent budgets. They use temporary vaults and app-data directories, disabled semantic indexing and events, the production save command, real Markdown publication, and the production SQLite codec. They do not substitute the earlier storage spike's synthetic rows. `RELEASE_METRIC` lines report sample count, p50, p95, maximum, and budget; an exceeded budget fails after the remaining measurements are collected. A metric with a null budget has no numerical pass/fail requirement; its `passed` field does not attest the separate changed-content cost requirement. The browser measurement includes fixture response, History Mode rendering, and two animation frames, and excludes Rust execution and IPC transport. Separate backend and rendering budgets do not establish a combined 250 ms response time.

## Operating limits and evidence

The fixture scans 1,000 existing managed notes, records 10,000 revisions on a 64 KiB note in one process, and then reaches exactly 100,000 revisions across the vault. It checks revision totals and traverses every hot-note revision without duplicate pages. A separate 1 MiB note receives 128 small changes plus 20 deterministic random-ASCII complete replacements. It measures deep reconstruction, restore preview, prepared-write failure/retry, clean close, restart integrity attestation, clear, and a 256 KiB compaction pass. Existing recovery tests supply interruption, corruption, store-replacement, clean-copy, purge, and observation-order coverage.

The 1 MiB, 10,000-per-note, and 100,000-per-vault limits are exercised separately; this is not a claim that a 1 MiB note with 10,000 revisions was tested. The small-edit large note has regular repetitive Markdown lines; complete replacements use deterministic random ASCII with similar line lengths. The earlier [codec spike](note-timeline-storage-spike.md) supplies additional pathological-delta evidence. The browser fixture measures one changed line in a 1 MiB diff; complete-replacement rendering has no measured release attestation here.

Measurements were taken on arm64 macOS (Darwin 25.6.0), Rust 1.93.1, Node 24.2.0, pnpm 11.21.0, Chrome 152.0.7977.77, and native WebKit 605.1.15. Other local work was running; these are observed timings, not claims about every supported machine. Cold startup integrity is measured separately from warm ordinary operations.

### Defects found and corrected

- A 1 MiB diff initially painted in 1,419.8 ms. Rendering every unchanged line created thousands of unnecessary DOM rows. The view now keeps three context lines at each end of long unchanged sections and exposes an explicit expansion action. The final focused browser rerun measured 123.6 ms and verified expansion plus reset on comparison change.
- A 50-row page of 1 MiB revisions initially measured 8,727.9 ms p95. Each row independently replayed its checkpoint chain. Page summaries now reconstruct oldest first and reuse only the previous verified authored state within the page. The first corrected run measured 176.7 ms p95; byte/hash verification remains in place.
- Diff preparation reconstructed parent and selected revision independently and loaded the entire revision chain. It now orders and validates the revision headers in linear time and reuses the verified parent payload when applicable. A persisted-checkpoint corruption regression ensures disconnected lineage remains rejected.
- Native tests loaded an unrelated IPv6 development server through `localhost:1420`. The E2E binary and runner now share a dedicated `127.0.0.1:1430` URL. The normal development server is unaffected.
- Native WebKit restored scroll but reset the saved selection to zero when the workspace focused CodeMirror's DOM element directly. History return now uses the existing editor focus capability. All four native timeline journeys passed after the correction.

## Availability observations and decision

The production decision is [ADR 0006](../adr/0006-keep-history-preparation-mandatory-in-production.md): retain mandatory durable preparation, with explicit recovery and no save-without-history bypass.

| Failure exercised | Observed contract / evidence | Usability and integrity consequence |
| --- | --- | --- |
| Preparation fails before first publication | `history_preparation_failure_publishes_nothing`; frontend `preserves dirty editor content when durable history preparation fails` | No canonical file or revision is invented; draft stays dirty and the error remains actionable. In-memory retention does not protect against a later process crash. |
| Preparation fails for an existing note at scale | Scale harness compares exact canonical bytes before/after failure, then retries | Existing saved content stays intact; retry saves the requested draft. |
| Finalization fails after publication | `committed_markdown_survives_finalization_failure_and_recovers_once` | Return committed identity/content with warning; recover exactly once instead of replaying the write. |
| Startup recovery or canonical read fails | `transient_startup_recovery_failure_can_be_retried`, `canonical_read_failure_keeps_pending_recovery_retryable` | Block new dependent work; retain recoverable intent until authoritative bytes can be read. |
| Selected store is missing, replaced, malformed, or rolled back | Missing-store, generation, instance, watermark, malformed-store, and corrupt-note tests | Current Markdown remains readable; writes need explicit recovery/reset. Silent acceptance would falsify retained history. |
| Reset rebuilding fails, or a Missing Note is unreconstructable | `failed_reset_rebuild_keeps_the_replacement_timeline_unavailable_until_retry`, `development_reset_refuses_to_discard_an_unreconstructable_missing_note` | Do not convert a failed recovery into a successful save or discard the only retained recoverable state. |
| Close or deletion is interrupted | Clean-close retry, pending-intent, interrupted clear/purge, WAL restart, and clean-copy tests | Retry/restart settles durable evidence; physical reclamation cannot redefine logical deletion. |

These are controlled failures observed in development tests. They do not estimate incident frequency, MTTR, power-loss behavior of physical hardware, or user success rates. No background telemetry or private note prose was collected. Fail-closed imposes real editing friction, but a bypass would conceal gaps from later timeline and provenance queries. The accepted policy preserves the stronger contract and makes that trade-off explicit.

## Release gate status

The completed correctness checks are:

| Check | Result |
| --- | --- |
| `pnpm check` | 0 errors, 0 warnings |
| `pnpm test` | 778 tests passed in 123 files |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 465 unit tests and 16 architecture checks passed; scale diagnostics explicitly excluded |
| `pnpm test:e2e:browser` | 11 browser journeys passed |
| `pnpm test:e2e:native` | 3 lifecycle and 4 timeline journeys passed, plus the TypeScript/Rust native contract fixture |

The full Rust run includes temporary-vault persistence, generated codec edits, fault injection, interruption/restart, replacement/corruption, clear/purge, and clean-close portability tests. The architecture suite guards canonical publication ownership, read-only History Mode, bounded chat access, and the private storage seam. Browser coverage includes returning to both editor selections and an exactly focused toolbar control.

### Final scale results

The 100,000-revision setup completed through the production save command without a publication warning. Its original binary was then stopped before the read measurements. A SQLite backup of the stable synthetic fixture and matching Markdown/app observations was restored at its original temporary paths, after the writer stopped. The corrected binary ran the common read/recovery phase against that fixture. This preserves real write-path evidence while avoiding a second 40-minute write setup; it is not evidence of a live-vault backup feature. An intermediate diagnostic was stopped after its cold measurement because its untimed count assertion redundantly performed 1,000 whole-database health checks; the harness now asserts the total directly in SQLite.

All observed runs, including intermediate failures under concurrent load, are retained in [the measurements JSON](note-timeline-release-measurements.json). The final backend run was performed without other test suites or compilers running during its timed phase.

| Final measurement | Samples | p50 | p95 | Budget |
| --- | ---: | ---: | ---: | ---: |
| 50-row pages across all 10,000 hot-note revisions | 200 | 28.3 ms | 43.6 ms | 250 ms |
| 64 KiB historical diff at vault scale | 20 | 14.8 ms | 18.1 ms | 250 ms |
| Deep 64 KiB reconstruction | 20 | 7.9 ms | 11.1 ms | 1,000 ms |
| 64 KiB restore preview | 20 | 9.1 ms | 11.8 ms | 1,000 ms |
| 50-row page of 1 MiB revisions | 20 | 127.8 ms | 129.2 ms | 250 ms |
| 1 MiB historical diff | 20 | 105.2 ms | 112.7 ms | 250 ms |
| 1 MiB restore preview | 20 | 103.2 ms | 110.5 ms | 1,000 ms |
| 1 MiB browser fixture to painted diff | 1 | 123.6 ms | — | 250 ms; excludes Rust/IPC |

The 1,000-note baseline scan took 5.73 seconds. The 64 KiB save p50 was 17.4 ms early and 15.0 ms at 10,000 revisions; the 1 KiB save p50 at 100,000 revisions was 10.5 ms. This shows no observed increase with retained revision count in this fixture. It does **not** establish changed-content cost: small edits to the 1 MiB note measured 88.5 ms p50 / 132.3 ms p95, while random full replacements measured 29.4 / 34.2 ms. The two workloads also differ in checkpoint/replay shape, so stage-level diagnosis is required. Retaining the 129 large-note revisions used 7,166 payload bytes; efficient retained size alone does not establish efficient save latency.

The injected preparation failure returned in 2.43 ms, preserved exact existing canonical bytes, and the subsequent retry succeeded. Clean close took 10.95 ms. First access on the retained fixture, including integrity/recovery, took 68.63 seconds (an earlier diagnostic took 70.71 seconds).

After clean close, restart plus first-page integrity/recovery took 74.07 seconds. Clearing the hot note left exactly one retained revision. The bounded compaction call took 8.07 ms and reclaimed no more than its 256 KiB budget. The corrected common read/recovery test completed successfully in 243.85 seconds, including both cold integrity passes and all remaining assertions.

### Decision

**Hold the release gate open.** Correctness suites and measured warm backend budgets pass, and ADR 0006 explicitly accepts mandatory history preparation. Release readiness still requires a combined native paging/diff measurement, evidence satisfying the changed-content write-cost requirement, and resolution of the long cold-recovery delay. These findings are tracked in [issue 35](../../.scratch/note-timelines/issues/35-close-release-latency-gaps.md). No save-without-history bypass was added to make the measurements pass.
